'use client'

import { parseProfile,
  MAX_ROOT_PTAGS,
  parseReaction,
} from '@nostrich/nostr'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  isReply,
  KINDS,
  NUTZAP_KIND,
  parseNutzap,
  resolveZapEndpoint,
  validateZapReceipt,
  type ZapReceipt,
  zapEndpointUrl,
  type Hex,
  type NostrEvent,
  type Profile,
  type Signer,
} from '@nostrich/nostr'

import { heldAlertEvents, newestKnownFor, newestZapKnownFor } from './account-alerts'
import { cachedOwnNoteIds, getCachedEvent, rememberEvents, rememberEventsPersisted } from './event-cache'
import { unwrapRepost } from './repost'
import { noteNotificationKind } from './note-notifications'
import { isThinMentioner, judgeMentioners, unjudged, useThinMentionsVersion } from './thin-mentions'
import { threadMentionsEnabled, useThreadMentionsValue } from './thread-mentions'
import { useHydrated } from './hydrated'
import { readCachedProfile, writeCachedProfile } from './profile-cache'
import { getPool } from './pool'
import { zapRelays } from './zap-relays'
import { firstLookAt } from './first-look'
import { onScopedChange, readScoped, writeScoped } from './scope'
import { NOTIFICATIONS_SEEN_KEY, ZAPS_SEEN_KEY as SHARED_ZAPS_SEEN_KEY } from './settings-keys'
import {
  announceableActor,
  bookmarkActor,
  notificationTarget,
  reactsToOwnReaction,
  suppressed,
} from './notification-suppress'
import {
  isSeeded,
  closeSeedHoles,
  demoteSeedCompleteness,
  noteFollowerCount,
  observeFollowers,
  retireFalseFollowers,
  seedKnownFollowers,
  seededAt,
  useKnownFollowers,
} from './known-followers'
import { observeFirstSeen, useFirstSeen } from './first-seen'

/** Everything on Nostr that is addressed. */

/** Zap receipts are the 9735 kind. */
const ZAP_RECEIPT = 9735
/** NIP-51 bookmark list. */
const BOOKMARK_LIST = 10003

/** How many of the reader's own notes are checked for bookmarks. */
const OWN_NOTES = 500
/** How many of them the bookmark and quote lookups ask. */
const BOOKMARK_LOOKBACK = 60

/** The notes the bookmark feature watches, and the ONLY definition of that set. */
function bookmarkHorizon(events: readonly NostrEvent[], pubkey: Hex | undefined): string[] {
  if (pubkey === undefined) return []
  return events
    .filter(event => MINE_KINDS.includes(event.kind) && event.pubkey === pubkey)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, BOOKMARK_LOOKBACK)
    .map(event => event.id)
}

/** People one note may tag before it stops being a mention. */
// The number itself lives in @nostrich/nostr, so every surface enforces the same one.
const MAX_MENTION_PTAGS = MAX_ROOT_PTAGS

/** Shared instance, so an empty result keeps a stable identity between renders. */
const EMPTY_EVENTS: NostrEvent[] = []

/** The ids of the reader's own recent notes, out of the events the query already. */
/** OUR OWN REACTIONS, so that a like OF a like can be told apart from a like of a note. */
function ownReactionIds(events: readonly NostrEvent[], pubkey: Hex | undefined): Set<string> {
  const out = cachedOwnNoteIds(pubkey, KINDS.reaction)
  if (pubkey === undefined) return out
  for (const event of events) {
    if (event.kind === KINDS.reaction && event.pubkey === pubkey) out.add(event.id)
  }
  return out
}

function ownNoteIds(events: readonly NostrEvent[], pubkey: Hex | undefined): Set<string> {
  const out = cachedOwnNoteIds(pubkey, ...MINE_KINDS)
  if (pubkey === undefined) return out
  for (const event of events) {
    if (MINE_KINDS.includes(event.kind) && event.pubkey === pubkey) out.add(event.id)
  }
  return out
}

/** What counts as something of MINE that somebody can answer. */
const MINE_KINDS: readonly number[] = [KINDS.shortNote, KINDS.comment]

const EMPTY_IDS: ReadonlySet<string> = new Set()

const LIMIT = 200

/** kind-1's own budget. See the filter list for why it is larger than `LIMIT`. */
const NOTE_LIMIT = 600
/** Contact lists are enormous. */
const FOLLOW_LIMIT = 20

/** How far back to look for follows, and why this filter alone gets a window. */
const FOLLOW_WINDOW_SECONDS = 4 * 24 * 60 * 60
const TIMEOUT_MS = 9_000

export type NotificationKind =
  | 'reply'
  | 'quote'
  | 'mention'
  /** A reply in a thread that carries your p-tag. */
  | 'thread'
  | 'reaction'
  | 'repost'
  | 'zap'
  | 'bookmark'
  | 'follow'

export interface NotificationItem {
  id: string
  kind: NotificationKind
  /** Who did it. For a zap this is the payer, never the receipt's signer. */
  actor: Hex
  createdAt: number
  /** The note of yours it concerns, when there is one. */
  targetId?: Hex
  /** Reaction content, or the zap comment, or the reply text. */
  content?: string
  amountSats?: number
  /** A zap whose payment nobody's lightning server vouched. */
  unsettled?: boolean
  /** The event itself, for rendering a reply in full. */
  event?: NostrEvent
}

/** The LNURL server pubkey for the VIEWER. */
function useLnurlPubkey(profile: Profile | null): Hex | undefined {
  const endpoint = profile === null ? null : zapEndpointUrl(profile)
  const query = useQuery({
    queryKey: ['lnurl-pubkey', endpoint ?? ''],
    enabled: endpoint !== null,
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<Hex | null> => {
      if (profile === null) return null
      // The core does the fetch and the validation.
      const resolved = await resolveZapEndpoint(profile)
      return resolved.ok ? (resolved.value.zapPubkey ?? null) : null
    },
  })
  return query.data ?? undefined
}

export interface NotificationsApi {
  items: NotificationItem[]
  /** The note each row concerns, keyed by id. */
  targets: Map<string, NostrEvent>
  /** True while the targets are still being fetched. */
  targetsResolving: boolean
  loading: boolean
  /** True when the account has no lightning address, so zaps cannot be verified. */
  zapsUnverifiable: boolean
  /** The newest thing this query holds that was addressed to the reader. */
  newestAt: number
  /** Ask the relays again. */
  refetch: () => void
}

/** Whether an event is the reader's business at all. */
/** Is this receipt worth showing at all, and does the reader's own server vouch. */
function zapNotification(
  event: NostrEvent,
  viewer: Hex,
  lnurlPubkey: Hex | undefined,
): { receipt: ZapReceipt } | null {
  const result = validateZapReceipt({
    receipt: event,
    ...(lnurlPubkey === undefined ? {} : { lnurlPubkey }),
    recipientPubkey: viewer,
  })
  return result.ok ? { receipt: result.value } : null
}

function countsAsNotification(
  event: NostrEvent,
  viewer: Hex,
  mine: ReadonlySet<string>,
  /** Ids of reactions WE published. */
  myReactions: ReadonlySet<string> = EMPTY_IDS,
): boolean {
  if (suppressed(event)) return false
  /** A contact list is never news on its own. */
  if (event.kind === KINDS.contacts || event.kind === BOOKMARK_LIST) return false
  /** A kind-1 is judged by WHOSE note it answers, not by the fact that it p-tags. */
  // Kind 1111 travels the same path: `noteNotificationKind` works off `parseThread`.
  if (event.kind === KINDS.shortNote || event.kind === KINDS.comment) {
    // Read here rather than threaded through every caller: this gate and the classifier.
    const noteKind = noteNotificationKind(event, viewer, mine, threadMentionsEnabled())
    if (noteKind === null) return false
    /** A MENTION FROM AN ACCOUNT WITH NO HISTORY IS NOT NEWS. */
    if (noteKind === 'mention' && isThinMentioner(event.pubkey as Hex, viewer)) return false
    return true
  }
  /* A zap counts only if the list would draw. */
  // A like of one of OUR likes.
  if (reactsToOwnReaction(event, myReactions)) return false

  if (event.kind === NUTZAP_KIND) return parseNutzap(event, viewer) !== undefined
  if (event.kind === ZAP_RECEIPT) return zapNotification(event, viewer, undefined) !== null

  // Your own actions are not news.
  return event.pubkey !== viewer
}

/** The one notifications query, shared by the page and the rail's unread dot. */
/** The filters that define "addressed to me", in one place. */
/** Zap receipts addressed to this reader. */
/** WHAT THIS BROWSER ALREADY HAD, merged back in rather than thrown away. */
function heldNotifications(_pubkey: Hex): NostrEvent[] {
  return []
}

/** When the cache was written, for the delta-vs-full-sweep decision. */
/** Whether the last cache write held EVERYTHING it was given, rather than a capped. */
function heldIsComplete(_pubkey: Hex): boolean {
  return false
}

function heldNotificationsAge(_pubkey: Hex): { at: number; newest: number } {
  return { at: 0, newest: 0 }
}

/** One event per id, first copy wins. */
function dedupeById(events: readonly NostrEvent[]): NostrEvent[] {
  const byId = new Map<string, NostrEvent>()
  for (const event of events) if (!byId.has(event.id)) byId.set(event.id, event)
  return [...byId.values()]
}

function zapReceiptFilter(pubkey: Hex, since?: number): Record<string, unknown> {
  // Both ways of being paid.
  return {
    kinds: [ZAP_RECEIPT, NUTZAP_KIND],
    '#p': [pubkey],
    limit: LIMIT,
    ...(since === undefined ? {} : { since }),
  }
}

function notificationFilters(
  pubkey: Hex,
  since?: number,
  /** The page reaches back `NOTE_LIMIT`. */
  noteLimit: number = NOTE_LIMIT,
): Record<string, unknown>[] {
  const window = since === undefined ? {} : { since }
  return [
    /** One kind per filter, because `limit` is applied PER FILTER. */
    /** kind-1 carries TWO notification kinds. */
    { kinds: [KINDS.shortNote], '#p': [pubkey], limit: noteLimit, ...window },
    /** NIP-22 comments, on a filter of their own rather than merged into the kind-1 one. */
    { kinds: [KINDS.comment], '#p': [pubkey], limit: LIMIT, ...window },
    { kinds: [KINDS.repost], '#p': [pubkey], limit: LIMIT, ...window },
    /* NEVER WINDOWED, unlike everything above. */
    zapReceiptFilter(pubkey),
    /** Follows, on a filter of their own: smaller, and windowed. */
  ]
}

/** Reactions, asked for SEPARATELY, for the same reason as contact lists and a sharper. */
function reactionFilters(pubkey: Hex, since?: number): Record<string, unknown>[] {
  const window = since === undefined ? {} : { since }
  return [{ kinds: [KINDS.reaction], '#p': [pubkey], limit: LIMIT, ...window }]
}

function reactionsQuery(pubkey: Hex | undefined) {
  return {
    queryKey: ['notification-reactions', pubkey ?? ''] as const,
    queryFn: async (): Promise<NostrEvent[]> => {
      if (pubkey === undefined) return []
      const found = await getPool().query(reactionFilters(pubkey) as never, undefined, TIMEOUT_MS)
      rememberEvents(found)
      return found
    },
    enabled: pubkey !== undefined,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  }
}

/** Contact lists, asked for SEPARATELY. */
function followerListsFilters(pubkey: Hex): Record<string, unknown>[] {
  return [
    {
      kinds: [KINDS.contacts],
      '#p': [pubkey],
      limit: FOLLOW_LIMIT,
      since: Math.floor(Date.now() / 1000) - FOLLOW_WINDOW_SECONDS,
    },
  ]
}

/** Bookmark lists are big. */
const BOOKMARK_LIMIT = 60

/** Who bookmarked one of the reader's notes. */
/** The reader's own recent notes. */
async function fetchOwnNotes(pubkey: Hex): Promise<NostrEvent[]> {
  /** TWO PAGES, because a relay caps a single filter at 500 and one page is not enough. */
  const first = await getPool().query(
    // Kind 1111 as well: a reply to a comment WE wrote is only recognised as ours.
    [{ kinds: [KINDS.shortNote, KINDS.comment], authors: [pubkey], limit: OWN_NOTES }] as never,
    undefined,
    TIMEOUT_MS,
  )
  const oldest = first.reduce(
    (low, event) => Math.min(low, event.created_at),
    Number.POSITIVE_INFINITY,
  )
  const older =
    first.length < OWN_NOTES || !Number.isFinite(oldest)
      ? []
      : await getPool()
          .query(
            [
              {
                kinds: [KINDS.shortNote, KINDS.comment],
                authors: [pubkey],
                limit: OWN_NOTES,
                until: oldest - 1,
              },
            ] as never,
            undefined,
            TIMEOUT_MS,
          )
          // A second page that fails is not a reason to lose the first.
          .catch(() => [])
  return [...first, ...older]
}

/** Bookmark and quote notices for the reader's recent notes. */
async function fetchBookmarkNotices(pubkey: Hex, own: readonly NostrEvent[]): Promise<NostrEvent[]> {
  // The newest sixty for the bookmark/quote questions.
  const ids = bookmarkHorizon(own, pubkey)
  if (ids.length === 0) return []

  /** Two questions about the same note ids, in one request. */
  const [lists, quotes] = await Promise.all([
    getPool().query(
      [{ kinds: [BOOKMARK_LIST], '#e': ids, limit: BOOKMARK_LIMIT }] as never,
      undefined,
      TIMEOUT_MS,
    ),
    getPool().query(
      [{ kinds: [KINDS.shortNote, KINDS.comment], '#q': ids, limit: LIMIT }] as never,
      undefined,
      TIMEOUT_MS,
    ),
  ])

  /* The notes are NOT returned again. */
  return [...lists, ...quotes]
}

/** How old a stored page may be and still be painted while a fresh one loads. */
const CACHE_MAX_MS = 6 * 60 * 60_000

/** How far below the newest cached row a delta fetch reaches. */
const DELTA_OVERLAP_SECONDS = 60 * 60

/** Events kept on disk. */
const CACHE_EVENTS = 150

/** Receipts kept, and deliberately far above `CACHE_EVENTS`. */
const CACHE_RECEIPTS = 120

/** The cache is capped in BYTES as well as in entries, because a count is not a size. */
export const CACHE_MAX_BYTES = 400 * 1024

/** Drop from the OLDEST end until it fits. */
export function withinBudget(events: readonly NostrEvent[]): NostrEvent[] {
  let kept = [...events]
  while (kept.length > 0 && JSON.stringify(kept).length * 2 > CACHE_MAX_BYTES) {
    /* From the END. */
    kept = kept.slice(0, kept.length - Math.max(1, Math.floor(kept.length * 0.1)))
  }
  return kept
}

const CACHE_KEY = 'notifications'

/** How many events the DOT fetches, against `NOTE_LIMIT` for the page. */
const DOT_LIMIT = 60

/** `noteLimit` is part of the KEY, not just the filter. */
/** PAINT WHAT HAS ARRIVED, instead of waiting for the slowest relay. */
function notificationsQuery(
  pubkey: Hex | undefined,
  noteLimit: number = NOTE_LIMIT,
  onPartial?: (event: NostrEvent) => void,
) {
  return {
    queryKey: ['notifications', pubkey ?? '', noteLimit] as const,
    /** The last page this browser saw, painted immediately. */
    placeholderData: (): NostrEvent[] | undefined => undefined,
    queryFn: async (): Promise<NostrEvent[]> => {
      if (pubkey === undefined) return []
      /* Three fetches, each allowed to fail on its own. */
      /* DELTA when the cache is fresh, full sweep. */
      const held = heldNotificationsAge(pubkey)
      /* The delta stands on its own. */
      const fresh =
        held.at !== 0 && Date.now() - held.at < CACHE_MAX_MS && heldIsComplete(pubkey)
      const since = fresh && held.newest > DELTA_OVERLAP_SECONDS ? held.newest - DELTA_OVERLAP_SECONDS : undefined
      const [found, own, wideZaps] = await Promise.all([
        getPool().query(
          notificationFilters(pubkey, since, noteLimit) as never,
          undefined,
          TIMEOUT_MS,
          // Streamed to the caller as each one lands.
          onPartial === undefined ? undefined : { onEvent: onPartial },
        ),
        // Without these no reply is recognised as a reply.
        fetchOwnNotes(pubkey).catch(() => [] as NostrEvent[]),
        // The same zap question asked of a wider set.
        getPool()
          // Unwindowed for the same reason as the filter above: a zap missed is money lost.
          .query([zapReceiptFilter(pubkey)] as never, zapRelays(), TIMEOUT_MS)
          .catch(() => [] as NostrEvent[]),
      ])
      // Depends on the notes above, so it runs after them.
      const bookmarks = await fetchBookmarkNotices(pubkey, own).catch(() => [] as NostrEvent[])

      /* THE ACTORS' PROFILES RIDE WITH THE NOTIFICATIONS. */
      void (async () => {
        // Fire-and-forget: the faces prime the NEXT paint and must never delay this one.
        const actors = new Set<string>()
        for (const event of [...found, ...wideZaps]) {
          if (event.pubkey !== pubkey) actors.add(event.pubkey)
        }
        const unknown = [...actors].filter(a => readCachedProfile(a as Hex) === undefined).slice(0, LIMIT)
        if (unknown.length === 0) return
        const metas = await getPool().query(
          [{ kinds: [0], authors: unknown }] as never,
          undefined,
          TIMEOUT_MS,
        )
        const newestByAuthor = new Map<string, NostrEvent>()
        for (const meta of metas) {
          const held = newestByAuthor.get(meta.pubkey)
          if (held === undefined || meta.created_at > held.created_at) newestByAuthor.set(meta.pubkey, meta)
        }
        for (const [author, meta] of newestByAuthor) {
          writeCachedProfile(author as Hex, parseProfile(meta))
        }
      })().catch(() => {
        // The rows matter more than the faces.
      })
      /* Deduped by id, which it did not need to be until the zap sweep above started asking. */
      const all = dedupeById([...found, ...own, ...bookmarks, ...wideZaps, ...heldNotifications(pubkey)])
      // The note each notification refers to is usually one.
      rememberEvents(all)
      /* The newest slice goes to disk. */
      if (all.length > 0) {
        /* MONEY GETS ITS OWN, MUCH LARGER BUDGET. */
        const byTime = (a: NostrEvent, b: NostrEvent): number => b.created_at - a.created_at
        const money = all.filter(event => event.kind === ZAP_RECEIPT || event.kind === NUTZAP_KIND)
        const rest = all.filter(event => event.kind !== ZAP_RECEIPT && event.kind !== NUTZAP_KIND)
        const newest = withinBudget(
          [
            ...money.sort(byTime).slice(0, CACHE_RECEIPTS),
            ...rest.sort(byTime).slice(0, CACHE_EVENTS),
          ].sort(byTime),
        )
      }
      return all
    },
    /** Ten minutes, not one. */
    /* …and ten minutes is only safe because of `retryEmpty` below. */
    gcTime: 30 * 60_000,
  }
}

/** Notifications as they arrive, pushed straight into the cache the dot reads. */
/** Bookmark lists, live. */
function useLiveBookmarks(pubkey: Hex | undefined): void {
  const queryClient = useQueryClient()
  const query = useQuery({ ...notificationsQuery(pubkey, DOT_LIMIT), enabled: pubkey !== undefined })

  // Joined so the effect compares by VALUE.
  const ownIds = bookmarkHorizon(query.data ?? EMPTY_EVENTS, pubkey).join(',')

  useEffect(() => {
    if (pubkey === undefined || ownIds === '') return
    const handle = getPool().subscribe({
      filters: [
        // A `limit` the one-shot twin has always.
        { kinds: [BOOKMARK_LIST], '#e': ownIds.split(','), limit: BOOKMARK_LIMIT },
        // Quotes of these notes, by `#q` rather than `#p`.
        { kinds: [KINDS.shortNote, KINDS.comment], '#q': ownIds.split(',') },
      ] as never,
      // Long-lived and novelty-carrying, like the stream above.
      live: true,
      onEvent: event => {
        rememberEvents([event])
        // `setQueriesData` matches by PREFIX, so one arrival reaches both the page's query.
        queryClient.setQueriesData<NostrEvent[]>({ queryKey: ['notifications', pubkey] }, held => {
          if (held === undefined) return held
          // A quote is an ordinary note: it joins the list, it does not replace anything.
          if (event.kind !== BOOKMARK_LIST) {
            return held.some(existing => existing.id === event.id) ? held : [event, ...held]
          }
          /** Replaceable, so the NEWEST copy replaces the old one rather than joining. */
          const without = held.filter(
            existing => !(existing.kind === BOOKMARK_LIST && existing.pubkey === event.pubkey),
          )
          if (without.length === held.length - 1) {
            const previous = held.find(
              existing => existing.kind === BOOKMARK_LIST && existing.pubkey === event.pubkey,
            )
            if (previous !== undefined && previous.created_at >= event.created_at) return held
          }
          return [event, ...without]
        })
      },
    })
    return () => handle.close()
  }, [pubkey, ownIds, queryClient])
}

/** REACTIONS, LIVE. */
function useLiveReactions(pubkey: Hex | undefined): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (pubkey === undefined) return
    // From now.
    const since = Math.floor(Date.now() / 1000)

    const handle = getPool().subscribe({
      filters: reactionFilters(pubkey, since) as never,
      // `live`: queued behind a screen's one-shot lookups it delivers nothing.
      live: true,
      onEvent: event => {
        rememberEvents([event])
        queryClient.setQueryData<NostrEvent[]>(
          reactionsQuery(pubkey).queryKey,
          held => {
            // Nothing fetched yet: the query is about to run and will include this anyway.
            if (held === undefined) return held
            if (held.some(existing => existing.id === event.id)) return held
            return [event, ...held]
          },
        )
      },
    })
    return () => handle.close()
  }, [pubkey, queryClient])
}

export function useLiveNotifications(pubkey: Hex | undefined): void {
  const queryClient = useQueryClient()
  useLiveBookmarks(pubkey)
  useLiveReactions(pubkey)

  useEffect(() => {
    if (pubkey === undefined) return
    // From now.
    const since = Math.floor(Date.now() / 1000)

    const handle = getPool().subscribe({
      filters: notificationFilters(pubkey, since) as never,
      // `live`: this is the subscription the unread dot and the arriving-notification row.
      live: true,
      onEvent: event => {
        rememberEvents([event])
        /** A receipt is money, and the ledger has to hear about it too. */
        if (event.kind === ZAP_RECEIPT) {
          void queryClient.invalidateQueries({ queryKey: ['profile-zaps', pubkey] })
        }
        // `setQueriesData` matches by PREFIX, so one arrival reaches both the page's query.
        queryClient.setQueriesData<NostrEvent[]>({ queryKey: ['notifications', pubkey] }, held => {
          // Nothing fetched yet: the query is about to run and will include this anyway.
          if (held === undefined) return held
          if (held.some(existing => existing.id === event.id)) return held
          return [event, ...held]
        })
      },
    })
    return () => handle.close()
  }, [pubkey, queryClient])
}

/** Judging who is allowed to mention the reader, behind the page. */
function useJudgeMentioners(events: readonly NostrEvent[], pubkey: Hex | undefined): void {
  const running = useRef(false)
  /* A dependency, not a value read here: a pass is capped at `MAX_PER_PASS`, so a burst. */
  const version = useThinMentionsVersion()

  useEffect(() => {
    if (pubkey === undefined || events.length === 0 || running.current) return
    const mine = ownNoteIds(events, pubkey)
    const threadMentions = threadMentionsEnabled()
    const authors: Hex[] = []
    for (const event of events) {
      if (event.kind !== KINDS.shortNote && event.kind !== KINDS.comment) continue
      if (event.pubkey === pubkey) continue
      // The same classifier the gate uses, so the accounts judged are exactly the accounts.
      if (noteNotificationKind(event, pubkey, mine, threadMentions) !== 'mention') continue
      authors.push(event.pubkey as Hex)
    }
    if (unjudged(authors, pubkey).length === 0) return
    running.current = true
    void judgeMentioners(authors, pubkey).finally(() => {
      running.current = false
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the drain signal
  }, [events, pubkey, version])
}

/** The same judgement, mounted app-wide so the DOT is not counting what the page would. */
export function useThinMentionWatch(pubkey: Hex | undefined): void {
  const query = useQuery({ ...notificationsQuery(pubkey, DOT_LIMIT), enabled: pubkey !== undefined })
  useJudgeMentioners(query.data ?? EMPTY_EVENTS, pubkey)
}

/** Contact lists naming the reader, observed and read in one place. */
/** How many contact lists the seeding query asks. */
const SEED_FOLLOWERS = 1_000

/** How old the seed may get before it is taken again. */
const RESEED_AFTER_SECONDS = 24 * 60 * 60

/** Seed the known-follower store once per account, from a wide query. */
function useSeedFollowers(pubkey: Hex | undefined): void {
  useEffect(() => {
    if (pubkey === undefined) return
    /** Re-seeded daily, not once ever. */
    const seeded = seededAt(pubkey)
    const stale = seeded > 0 && Math.floor(Date.now() / 1000) - seeded > RESEED_AFTER_SECONDS
    if (isSeeded(pubkey) && !stale) return

    let cancelled = false
    void (async () => {
      try {
        const lists = await getPool().query(
          [{ kinds: [KINDS.contacts], '#p': [pubkey], limit: SEED_FOLLOWERS }] as never,
          undefined,
          TIMEOUT_MS,
        )
        if (cancelled) return
        const others = lists.filter(event => event.pubkey !== pubkey)
        if (seeded === 0) {
          // `lists`, not `others`: the ceiling is about what the RELAYS returned.
          seedKnownFollowers(
            pubkey,
            others.map(event => event.pubkey),
            lists.length < SEED_FOLLOWERS,
          )
          /* And immediately reconsider it, because the ceiling above cannot see a relay's own. */
          void getPool()
            .count([{ kinds: [KINDS.contacts], '#p': [pubkey] }] as never, undefined, TIMEOUT_MS)
            .then(count => {
              if (!cancelled) demoteSeedCompleteness(pubkey, lists.length, count)
            })
            .catch(() => {
              // No relay answered COUNT. The ceiling test stands.
            })
          return
        }
        /* A later pass only fills holes, and only with authors whose newest list predates. */
        closeSeedHoles(
          pubkey,
          others.filter(event => event.created_at <= seeded).map(event => event.pubkey),
        )
      } catch {
        // Left unseeded on purpose.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pubkey])
}

/** The follow lists that name this reader, on their own budget. */
function followerListsQuery(pubkey: Hex | undefined) {
  return {
    queryKey: ['follower-lists', pubkey ?? ''] as const,
    queryFn: async (): Promise<NostrEvent[]> => {
      if (pubkey === undefined) return []
      return getPool().query(followerListsFilters(pubkey) as never, undefined, TIMEOUT_MS)
    },
    enabled: pubkey !== undefined,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  }
}

/** HOW MANY contact lists name this reader, from our own relays. */
function followerCountQuery(pubkey: Hex | undefined) {
  return {
    queryKey: ['follower-count', pubkey ?? ''] as const,
    queryFn: async (): Promise<number | undefined> => {
      if (pubkey === undefined) return undefined
      return getPool().count(
        [{ kinds: [KINDS.contacts], '#p': [pubkey] }] as never,
        undefined,
        TIMEOUT_MS,
      )
    },
    enabled: pubkey !== undefined,
    /* Two minutes, down from ten. */
    staleTime: 2 * 60_000,
    gcTime: 30 * 60_000,
  }
}

function useFollowerLists(
  pubkey: Hex | undefined,
  /** False once our own server is answering the follower question. */
  enabled = true,
): {
  lists: NostrEvent[]
  seen: Record<string, number>
} {
  // Nothing is announced until this has run.
  useSeedFollowers(enabled ? pubkey : undefined)

  const query = useQuery({ ...followerListsQuery(pubkey), enabled: enabled && pubkey !== undefined })
  const events = query.data ?? EMPTY_EVENTS

  const lists = useMemo(() => {
    // Newest list per person: an older copy may predate the follow, and its age.
    const newest = new Map<Hex, NostrEvent>()
    for (const event of events) {
      if (event.kind !== KINDS.contacts || event.pubkey === pubkey) continue
      const held = newest.get(event.pubkey)
      if (held === undefined || event.created_at > held.created_at) newest.set(event.pubkey, event)
    }
    return [...newest.values()]
  }, [events, pubkey])

  /** Who among them can be SHOWN to have followed already, and who can be shown. */
  const { alreadyFollowing, provenNew } = useVerifiedFollowers(pubkey, lists)

  /** The number that licenses calling anybody new. */
  const relayCount = useQuery(followerCountQuery(pubkey))
  useEffect(() => {
    noteFollowerCount(pubkey, relayCount.data, 'relay')
  }, [pubkey, relayCount.data])

  /** HOW MANY people follow this reader, which is what licenses saying anybody is new. */

  useEffect(() => {
    observeFollowers(
      pubkey,
      lists.map(event => ({ pubkey: event.pubkey, listUpdatedAt: event.created_at })),
      alreadyFollowing,
      provenNew,
    )
  }, [pubkey, lists, alreadyFollowing, provenNew])

  return { lists, seen: useKnownFollowers(pubkey) }
}

/** Which of these authors were ALREADY following before this browser started watching. */
function useVerifiedFollowers(
  pubkey: Hex | undefined,
  lists: readonly NostrEvent[],
): { alreadyFollowing: ReadonlySet<Hex>; provenNew: ReadonlySet<Hex> } {
  const startedWatching = pubkey === undefined ? 0 : seededAt(pubkey)

  /** Only the ones a verdict could change: published after we started watching, still. */
  const candidates = useMemo(() => {
    if (startedWatching === 0) return ''
    const now = Math.floor(Date.now() / 1000)
    return lists
      .filter(
        event =>
          event.created_at > startedWatching && now - event.created_at < FOLLOW_WINDOW_SECONDS,
      )
      .map(event => event.pubkey)
      .sort()
      .join(',')
  }, [lists, startedWatching])

  const query = useQuery({
    queryKey: ['followers-verify', pubkey ?? '', candidates],
    queryFn: async (): Promise<{ following: Hex[]; new: Hex[] }> => {
      if (pubkey === undefined || candidates === '') return { following: [], new: [] }
      const authors = candidates.split(',') as Hex[]
      const earlier = await getPool().query(
        [{ kinds: [KINDS.contacts], authors, until: startedWatching }] as never,
        undefined,
        TIMEOUT_MS,
      )
      // Newest copy per author that predates us watching, and whether it named the reader.
      const newest = new Map<Hex, NostrEvent>()
      for (const event of earlier) {
        const held = newest.get(event.pubkey)
        if (held === undefined || event.created_at > held.created_at) newest.set(event.pubkey, event)
      }
      /* THREE OUTCOMES, not two. */
      const following: Hex[] = []
      const fresh: Hex[] = []
      for (const event of newest.values()) {
        if (event.tags.some(tag => tag[0] === 'p' && tag[1] === pubkey)) following.push(event.pubkey)
        else fresh.push(event.pubkey)
      }
      return { following, new: fresh }
    },
    enabled: pubkey !== undefined && candidates !== '',
    // A fact about the past.
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  })

  const verified = useMemo(() => new Set(query.data?.following ?? []), [query.data])
  const provenNew = useMemo(() => new Set(query.data?.new ?? []), [query.data])

  /* The same verdict, applied backwards once to whatever was announced. */
  useEffect(() => {
    retireFalseFollowers(pubkey, verified)
  }, [pubkey, verified])

  return { alreadyFollowing: verified, provenNew }
}

interface BookmarkEntry {
  key: string
  writtenAt: number
  actor: Hex
  targetId: Hex
  event: NostrEvent
}

/** Bookmarks of the reader's own notes, observed and read in one place. */
function useKnownBookmarks(
  events: readonly NostrEvent[],
  pubkey: Hex | undefined,
): { entries: BookmarkEntry[]; seen: Record<string, number> } {
  const entries = useMemo(() => {
    if (pubkey === undefined) return []
    /* The SAME sixty notes the subscription watches. */
    const own = new Set(bookmarkHorizon(events, pubkey))
    const out: BookmarkEntry[] = []
    for (const event of events) {
      if (event.kind !== BOOKMARK_LIST || event.pubkey === pubkey) continue
      for (const tag of event.tags) {
        if (tag[0] !== 'e' || tag[1] === undefined) continue
        // Only OUR notes.
        if (!own.has(tag[1])) continue
        out.push({
          key: `${event.pubkey}:${tag[1]}`,
          writtenAt: event.created_at,
          actor: event.pubkey,
          targetId: tag[1] as Hex,
          event,
        })
      }
    }
    return out
  }, [events, pubkey])

  useEffect(() => {
    observeFirstSeen('bookmarks', pubkey, entries, {
      max: 4_000,
      freshWithin: 3 * 24 * 60 * 60,
    })
  }, [pubkey, entries])

  return { entries, seen: useFirstSeen('bookmarks', pubkey) }
}

export function useNotifications(
  pubkey: Hex | undefined,
  profile: Profile | null,
  /** Only to sign the two requests behind server-sourced follower rows. */
  signer?: Signer,
  /** WARMING, not showing. */
  warm = false,
): NotificationsApi {
  const lnurlPubkey = useLnurlPubkey(profile)

  /** Cached, like every other list in the app. */
  /** PAINTS FROM WHAT THE DOT ALREADY HAS, instead of starting from nothing every visit. */
  const client = useQueryClient()
  /** ALWAYS ASK AGAIN ON ARRIVAL, behind the rows that are already on screen. */
  /** STREAM THE FIRST LOAD, and only the first load. */
  const streamKey = pubkey === undefined ? '' : notificationsQuery(pubkey).queryKey.join(':')
  /** True once this mount has begun painting from the stream, so it may keep doing. */
  const streamedRef = useRef(false)
  useEffect(() => {
    streamedRef.current = false
  }, [streamKey])

  const onPartial = useCallback(
    (event: NostrEvent): void => {
      if (pubkey === undefined) return
      /* THE PLACEHOLDER COUNTS AS "already on screen", and it is not in the cache. */
      if (!streamedRef.current) {
        const shown = client.getQueryData<NostrEvent[]>(notificationsQuery(pubkey, DOT_LIMIT).queryKey)
        if ((shown?.length ?? 0) > 0) return
      }
      const { queryKey } = notificationsQuery(pubkey)
      client.setQueryData<NostrEvent[]>(queryKey, held => {
        if (!streamedRef.current && (held?.length ?? 0) > 0) return held
        streamedRef.current = true
        const list = held ?? []
        if (list.some(existing => existing.id === event.id)) return list
        return [event, ...list]
      })
    },
    // `streamKey` stands in for the pubkey so the callback is stable across unrelated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, streamKey],
  )

  const query = useQuery({
    ...notificationsQuery(pubkey, NOTE_LIMIT, onPartial),
    enabled: pubkey !== undefined,
    refetchOnMount: 'always',
    placeholderData: () =>
      pubkey === undefined
        ? undefined
        : client.getQueryData<NostrEvent[]>(notificationsQuery(pubkey, DOT_LIMIT).queryKey),
  })

  /** CATCH UP WHEN THE BACKGROUND WATCH KNOWS SOMETHING THIS LIST DOES. */
  const chasedRef = useRef(0)
  const newestKnown = pubkey === undefined ? 0 : newestKnownFor(pubkey)
  /* Reactions arrive on their own query. */
  const reactions = useQuery({ ...reactionsQuery(pubkey), refetchOnMount: 'always' })

  const events = useMemo(
    () => [...(query.data ?? EMPTY_EVENTS), ...(reactions.data ?? EMPTY_EVENTS)],
    [query.data, reactions.data],
  )
  // Pending only on a first load.
  /* `isPending` stays TRUE under `placeholderData`. */
  /** SEEDED FROM DISK AFTER HYDRATION, because `placeholderData` cannot. */
  const hydrated = useHydrated()
  useEffect(() => {
    if (!hydrated || pubkey === undefined) return
    const { queryKey } = notificationsQuery(pubkey)
    /* WHAT THE BACKGROUND WATCH ALREADY SAW GOES IN TOO. */
    const seed = dedupeById([...heldAlertEvents(pubkey), ...heldNotifications(pubkey)])
    const existing = client.getQueryData<NostrEvent[]>(queryKey)
    if (existing !== undefined) {
      // Already populated by an earlier visit in this session.
      const known = new Set(existing.map(event => event.id))
      const extra = heldAlertEvents(pubkey).filter(event => !known.has(event.id))
      if (extra.length > 0) {
        client.setQueryData(queryKey, dedupeById([...extra, ...existing]), { updatedAt: 0 })
      }
      return
    }
    if (seed.length > 0) client.setQueryData(queryKey, seed, { updatedAt: 0 })
  }, [client, hydrated, pubkey])

  const loading = query.isPending && pubkey !== undefined && query.data === undefined
  const { refetch: refetchQuery } = query
  const refetch = useCallback(() => {
    void refetchQuery()
  }, [refetchQuery])

  /** Which notes are the reader's own. */

  /** CATCH UP WHEN THE BACKGROUND WATCH KNOWS SOMETHING THIS LIST DOES. */
  const newestHeld = useMemo(
    () => events.reduce((max, event) => Math.max(max, event.created_at), 0),
    [events],
  )
  const refetchNotifications = query.refetch
  const refetchReactions = reactions.refetch
  useEffect(() => {
    if (pubkey === undefined || newestKnown <= newestHeld) return
    if (chasedRef.current >= newestKnown) return
    chasedRef.current = newestKnown
    void refetchNotifications()
    void refetchReactions()
  }, [pubkey, newestKnown, newestHeld, refetchNotifications, refetchReactions])

  const mine = useMemo(() => ownNoteIds(events, pubkey), [events, pubkey])
  const myReactions = useMemo(() => ownReactionIds(events, pubkey), [events, pubkey])
  // Subscribed, not merely read: `countsAsNotification` asks the store itself.
  const threadMentions = useThreadMentionsValue()
  // Likewise for the mention gate: `isThinMentioner` reads a module store.
  const thinVersion = useThinMentionsVersion()

  /* The page judges from the FULL list, not the sixty rows the rail fetches. */
  useJudgeMentioners(events, pubkey)

  /** Everyone whose contact list p-tags the reader, handed to the store that decides. */

  /** Bookmark lists are replaceable too, so the same rule applies: somebody re-saving. */
  /* Never while warming, and never once the server is answering. */
  const { lists: contactLists, seen: knownFollowers } = useFollowerLists(pubkey, !warm)
  const { entries: bookmarkEntries, seen: knownBookmarks } = useKnownBookmarks(events, pubkey)

  const items = useMemo<NotificationItem[]>(() => {
    if (pubkey === undefined) return []
    const out: NotificationItem[] = []

    for (const event of events) {
      if (!countsAsNotification(event, pubkey, mine, myReactions)) continue

      if (event.kind === NUTZAP_KIND) {
        /* ECASH, shown in the same column as a lightning zap because to the reader. */
        const nut = parseNutzap(event, pubkey)
        if (nut === undefined) continue
        out.push({
          id: event.id,
          kind: 'zap',
          // The event's author IS the payer here, unlike a receipt, whose author is a server.
          actor: nut.sender,
          createdAt: nut.createdAt,
          ...(nut.targetId === undefined ? {} : { targetId: nut.targetId }),
          ...(nut.comment === '' ? {} : { content: nut.comment }),
          amountSats: nut.amountSats,
          event,
        })
        continue
      }

      if (event.kind === ZAP_RECEIPT) {
        /* TWO TIERS, both shown, only one of them called settled. */
        const zap = zapNotification(event, pubkey, lnurlPubkey)
        if (zap === null) continue
        const receipt = zap.receipt
        out.push({
          id: event.id,
          kind: 'zap',
          actor: receipt.senderPubkey,
          createdAt: receipt.createdAt,
          ...(receipt.eventId === undefined ? {} : { targetId: receipt.eventId }),
          ...(receipt.comment === undefined ? {} : { content: receipt.comment }),
          amountSats: Math.round(receipt.amountMsat / 1000),
          // The reader's lightning server did not vouch for this one: real zap request, real.
          ...(receipt.issuerVerified ? {} : { unsettled: true }),
          event,
        })
        continue
      }

      /** A REACTION names its subject in the LAST e-tag, not the first. */
      // An e-tag first, because for a REPLY that is the note being answered and it must win.
      const target = notificationTarget(event)
      // NIP-25 normalises an empty reaction to '+', so the row draws one form.
      const reaction = event.kind === KINDS.reaction ? parseReaction(event) : undefined

      const base = {
        id: event.id,
        actor: event.pubkey,
        createdAt: event.created_at,
        ...(target === undefined ? {} : { targetId: target }),
        event,
      }

      if (event.kind === KINDS.reaction) {
        out.push({ ...base, kind: 'reaction', content: reaction?.content ?? event.content })
      } else if (event.kind === KINDS.repost) {
        out.push({ ...base, kind: 'repost' })
      } else {
        /** Reply, quote or mention. */
        out.push({
          ...base,
          kind: noteNotificationKind(event, pubkey, mine, threadMentionsEnabled()) ?? 'mention',
          content: event.content,
        })
      }
    }

    /** "Followed you". */
    /* ROWS COME FROM THE STORE, NOT FROM THE FETCH. */
    /* SERVER ROWS FIRST, and they win. */
    const announced = new Set<Hex>()

    const listByAuthor = new Map(contactLists.map(event => [event.pubkey, event]))
    for (const [author, firstSeen] of Object.entries(knownFollowers)) {
      if (firstSeen === 0) continue
      if (announced.has(author as Hex)) continue
      if (!announceableActor(author as Hex)) continue
      const event = listByAuthor.get(author as Hex)
      out.push({
        id: `follow:${author}`,
        kind: 'follow',
        actor: author as Hex,
        /** The EARLIER of the two, which is almost always the list's own timestamp. */
        /* The list's own time when we still have it, capped by when we noticed. */
        createdAt: event === undefined ? firstSeen : Math.min(firstSeen, event.created_at),
      })
    }

    /** Bookmarks, built OUTSIDE the loop above. */
    for (const entry of bookmarkEntries) {
      const firstSeen = knownBookmarks[entry.key]
      // Undefined means not yet observed.
      if (firstSeen === undefined || firstSeen === 0) continue
      if (!announceableActor(entry.actor)) continue
      out.push({
        id: `bookmark:${entry.key}`,
        kind: 'bookmark',
        actor: entry.actor,
        /* The earlier of the two, exactly as the follow branch above does. */
        createdAt: Math.min(firstSeen, entry.writtenAt),
        targetId: entry.targetId,
        event: entry.event,
      })
    }

    const deduped = new Map<string, NotificationItem>()
    for (const item of out) {
      const held = deduped.get(item.id)
      if (held === undefined || item.createdAt > held.createdAt) deduped.set(item.id, item)
    }
    /* Ties broken by id, which makes this a TOTAL order. */
    return [...deduped.values()].sort(
      (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    // `thinVersion` is the signal, not a value read here: a verdict landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- thinVersion is the signal
  }, [events, pubkey, lnurlPubkey, knownFollowers, knownBookmarks, bookmarkEntries, threadMentions, thinVersion])

  /** Computed from `events`, not from `items`, and that is the entire point. */
  const newestAt = useMemo(() => {
    if (pubkey === undefined) return 0
    let newest = 0
    for (const event of events) {
      if (countsAsNotification(event, pubkey, mine, myReactions) && event.created_at > newest) {
        newest = event.created_at
      }
    }
    // Follows are timestamped by discovery rather than by the event.
    for (const [author, at] of Object.entries(knownFollowers)) {
      if (at > newest && announceableActor(author as Hex)) newest = at
    }
    for (const [key, at] of Object.entries(knownBookmarks)) {
      if (at > newest && announceableActor(bookmarkActor(key))) newest = at
    }
    return newest
    // Same reason as the two memos above: this high-water mark is computed.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- thinVersion is the signal
  }, [events, pubkey, knownFollowers, knownBookmarks, threadMentions, thinVersion])

  /** Capped, and in row order so the cap falls on the oldest rows. */
  const targetIds = useMemo(
    () =>
      items
        .flatMap(item => (item.targetId === undefined ? [] : [item.targetId]))
        .slice(0, MAX_TARGETS),
    [items],
  )
  const { targets, resolving: targetsResolving } = useTargets(targetIds)

  return {
    items,
    targets,
    targetsResolving,
    loading,
    // True when nothing can attest that a zap was PAID: the reader has no lightning.
    zapsUnverifiable: profile !== null && zapEndpointUrl(profile) === null,
    newestAt,
    refetch,
  }
}

/** The notes every row. */
/** The note each notification is about, fetched INCREMENTALLY. */
function useTargets(ids: readonly Hex[]): { targets: Map<string, NostrEvent>; resolving: boolean } {
  /** Ids already asked about, so a wave never re-asks. */
  const asked = useRef<Set<string>>(new Set())
  const [round, nextRound] = useReducer((n: number) => n + 1, 0)
  const [inFlight, setInFlight] = useState(0)

  const wanted = useMemo(
    () =>
      [...new Set(ids)].filter(id => getCachedEvent(id) === undefined && !asked.current.has(id)),
    // `round` so the list is recomputed once a fetch lands: those ids are now cached.
    [ids, round],
  )

  useEffect(() => {
    if (wanted.length === 0) return
    for (const id of wanted) asked.current.add(id)
    let alive = true
    setInFlight((count: number) => count + 1)
    void (async () => {
      // Chunked: a relay rejects an oversized filter outright, and a page of notifications.
      const chunks: Hex[][] = []
      for (let at = 0; at < wanted.length; at += TARGET_CHUNK) {
        chunks.push(wanted.slice(at, at + TARGET_CHUNK))
      }
      try {
        const found = await getPool().query(
          chunks.map(chunk => ({ ids: chunk })),
          undefined,
          TIMEOUT_MS,
        )
        /* TO DISK, not just to memory. */
        rememberEventsPersisted(found)
        rememberEvents(found)
      } catch {
        // A dead relay set is not a reason to retry forever.
      }
      if (!alive) return
      setInFlight((count: number) => count - 1)
      nextRound()
    })()
    return () => {
      alive = false
    }
  }, [wanted])

  const targets = useMemo(() => {
    const out = new Map<string, NostrEvent>()
    /* Unwrapped here, once, rather than at each of the places that draw one. */
    for (const id of ids) {
      const event = getCachedEvent(id)
      if (event !== undefined) out.set(id, unwrapRepost(event))
    }
    return out
  }, [ids, round])

  return { targets, resolving: inFlight > 0 }
}

/** Ids per filter. */
const TARGET_CHUNK = 100
const MAX_TARGETS = 300

// ---------------------------------------------------------------------------.

const SEEN_KEY = NOTIFICATIONS_SEEN_KEY

/** When the reader last looked. */
function readSeen(): number {
  const raw = Number(readScoped(SEEN_KEY))
  return Number.isFinite(raw) ? raw : 0
}

/** How many notifications have landed since the page was last opened. */
export function useNotificationsUnread(pubkey: Hex | undefined): number {
  const { seenAt } = useNotificationsSeen()
  /** The same query as `useNotifications`, enabled. */
  const query = useQuery({ ...notificationsQuery(pubkey, DOT_LIMIT), enabled: pubkey !== undefined })

  /** Observed HERE as well, not just read. */
  // Both halves, same as the page.
  const reactions = useQuery(reactionsQuery(pubkey))
  const events = useMemo(
    () => [...(query.data ?? EMPTY_EVENTS), ...(reactions.data ?? EMPTY_EVENTS)],
    [query.data, reactions.data],
  )
  /** THE STORED MAP, not a fetch. */
  const knownFollowers = useKnownFollowers(pubkey)
  const { seen: knownBookmarks } = useKnownBookmarks(events, pubkey)
  // The same derivation the page makes, from the same events.
  const mine = useMemo(() => ownNoteIds(events, pubkey), [events, pubkey])
  const myReactions = useMemo(() => ownReactionIds(events, pubkey), [events, pubkey])
  // Subscribed, not merely read: `countsAsNotification` asks the store itself.
  const threadMentions = useThreadMentionsValue()
  // Likewise for the mention gate: `isThinMentioner` reads a module store.
  const thinVersion = useThinMentionsVersion()

  return useMemo(() => {
    if (pubkey === undefined) return 0
    /** No marker means this browser has never looked, NOT that everything is read. */
    const floor = seenAt > 0 ? seenAt : firstLookAt(pubkey)

    /** What the account switcher already knew, while this query is still running. */
    /* `isFetching`, not only `isPending`. */
    if ((query.isPending || query.isFetching) && newestKnownFor(pubkey) > floor) return 1
    const direct = events.filter(
      event => event.created_at > floor && countsAsNotification(event, pubkey, mine, myReactions),
    ).length
    // Plus anyone newly discovered following, and anyone who saved one of your notes.
    const follows = Object.entries(knownFollowers).filter(
      ([author, at]) => at > floor && announceableActor(author as Hex),
    ).length
    const bookmarks = Object.entries(knownBookmarks).filter(
      ([key, at]) => at > floor && announceableActor(bookmarkActor(key)),
    ).length
    return direct + follows + bookmarks
    // `isPending` AND `isFetching` are dependencies: the shortcut above reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- thinVersion is the signal
  }, [
    events, seenAt, pubkey, mine, knownFollowers, knownBookmarks,
    query.isPending, query.isFetching, threadMentions, thinVersion,
  ])
}

/** The read marker, as ONE value shared by every reader. */
let seenAtValue: number | undefined
const seenListeners = new Set<() => void>()

function seenSnapshot(): number {
  if (seenAtValue === undefined) seenAtValue = readSeen()
  return seenAtValue
}

/** The server has no storage, and must agree with the first client render. */
function seenServerSnapshot(): number {
  return 0
}

function subscribeSeen(listener: () => void): () => void {
  seenListeners.add(listener)
  return () => seenListeners.delete(listener)
}

export function useNotificationsSeen(): { seenAt: number; markSeen: (at: number) => void } {
  const seenAt = useSyncExternalStore(subscribeSeen, seenSnapshot, seenServerSnapshot)

  const markSeen = useCallback((at: number) => {
    // Never moves backwards: opening an older view must not un-read newer items.
    const next = Math.max(seenSnapshot(), at)
    if (next === seenAtValue) return
    seenAtValue = next
    writeScoped(SEEN_KEY, String(next))
    for (const listener of seenListeners) listener()
  }, [])

  return { seenAt, markSeen }
}

// --------------------------------------------------------------------------- Zaps.

const ZAPS_SEEN_KEY = SHARED_ZAPS_SEEN_KEY

let zapsSeenValue: number | undefined
const zapsSeenListeners = new Set<() => void>()

function zapsSeenSnapshot(): number {
  if (zapsSeenValue === undefined) {
    if (typeof window === 'undefined') return 0
    const raw = Number(readScoped(ZAPS_SEEN_KEY))
    zapsSeenValue = Number.isFinite(raw) ? raw : 0
  }
  return zapsSeenValue
}

/** A read marker belongs to the account that read. */
onScopedChange(base => {
  if (base === undefined || base === SEEN_KEY) {
    seenAtValue = undefined
    for (const listener of seenListeners) listener()
  }
  if (base === undefined || base === ZAPS_SEEN_KEY) {
    zapsSeenValue = undefined
    for (const listener of zapsSeenListeners) listener()
  }
})

function subscribeZapsSeen(listener: () => void): () => void {
  zapsSeenListeners.add(listener)
  return () => zapsSeenListeners.delete(listener)
}

/** The Zaps page's own read marker. */
export function useZapsSeen(): { seenAt: number; markSeen: (at: number) => void } {
  const seenAt = useSyncExternalStore(subscribeZapsSeen, zapsSeenSnapshot, () => 0)

  const markSeen = useCallback((at: number) => {
    const next = Math.max(zapsSeenSnapshot(), at)
    if (next === zapsSeenValue) return
    zapsSeenValue = next
    writeScoped(ZAPS_SEEN_KEY, String(next))
    for (const listener of zapsSeenListeners) listener()
  }, [])

  return { seenAt, markSeen }
}

/** Both read markers, for the code that carries them between devices. */
export interface SeenMarkers {
  notifications: number
  zaps: number
}

export function seenMarkers(): SeenMarkers {
  return { notifications: seenSnapshot(), zaps: zapsSeenSnapshot() }
}

/** Take the higher of ours and theirs, for each marker. */
export function adoptSeenMarkers(next: Partial<SeenMarkers>): void {
  if (next.notifications !== undefined && next.notifications > seenSnapshot()) {
    seenAtValue = next.notifications
    writeMarker(SEEN_KEY, seenAtValue)
    for (const listener of seenListeners) listener()
  }
  if (next.zaps !== undefined && next.zaps > zapsSeenSnapshot()) {
    zapsSeenValue = next.zaps
    writeMarker(ZAPS_SEEN_KEY, zapsSeenValue)
    for (const listener of zapsSeenListeners) listener()
  }
}

/** Fires whenever either marker moves, from a read on this device or from another one. */
export function onSeenMarkersChange(listener: () => void): () => void {
  seenListeners.add(listener)
  zapsSeenListeners.add(listener)
  return () => {
    seenListeners.delete(listener)
    zapsSeenListeners.delete(listener)
  }
}

/** Through the per-account layer, like every other write to these keys. */
function writeMarker(key: string, value: number): void {
  writeScoped(key, String(value))
}

/** Zap receipts that landed since the reader last opened Zaps. */
export function useZapsUnread(pubkey: Hex | undefined): number {
  const { seenAt } = useZapsSeen()
  const query = useQuery({ ...notificationsQuery(pubkey, DOT_LIMIT), enabled: pubkey !== undefined })

  return useMemo(() => {
    if (pubkey === undefined) return 0
    // Same floor as the notifications dot.
    const floor = seenAt > 0 ? seenAt : firstLookAt(pubkey)

    /** What the account switcher already knew, while this query is still running. */
    // `newestZapKnownFor`, not `newestKnownFor`: the handover may only be lit by money.
    if ((query.isPending || query.isFetching) && newestZapKnownFor(pubkey) > floor) return 1
    return (query.data ?? []).filter(
      event => event.kind === ZAP_RECEIPT && event.created_at > floor,
    ).length
    // Both flags are read by the shortcut above, so both must invalidate.
  }, [query.data, seenAt, pubkey, query.isPending, query.isFetching])
}

/** The newest zap receipt this query holds, for the Zaps page to mark on open. */
export function useNewestZapAt(pubkey: Hex | undefined): number {
  const query = useQuery({ ...notificationsQuery(pubkey, DOT_LIMIT), enabled: pubkey !== undefined })
  return useMemo(() => {
    let newest = 0
    for (const event of query.data ?? []) {
      if (event.kind === ZAP_RECEIPT && event.created_at > newest) newest = event.created_at
    }
    return newest
  }, [query.data])
}
