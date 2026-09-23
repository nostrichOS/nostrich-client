'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { KINDS, MAX_ROOT_PTAGS, NUTZAP_KIND, type Hex, type NostrEvent, type Signer } from '@nostrich/nostr'

import { recordWraps, subscribeChatWraps, unreadChatWraps } from './chat-alerts'
import { cachedOwnNoteIds, rememberEvent } from './event-cache'
import { noteNotificationKind } from './note-notifications'
import { threadMentionsEnabledFor } from './thread-mentions'
import { firstLookAt } from './first-look'
import { isBlockedFromDiscovery, isTagSpam } from './spam'
/** The kinds a stranger can answer. */
const MINE_KINDS = [KINDS.shortNote, KINDS.comment]
import { isMutedContent } from './muted-content'
import { isMuted } from './user-lists'
import { getPool } from './pool'
import { applyScoped, scopedRecord } from './scope'
import { parseSeenPayload } from './seen-sync'
import { NOTIFICATIONS_SEEN_KEY, ZAPS_SEEN_KEY } from './settings-keys'

/** "Something happened on your OTHER account." Signing in with more than one identity. */

/** The two kinds our KINDS map predates. */
const ZAP_RECEIPT = 9735
const GIFT_WRAP = 1059

/** Where `seen-sync` publishes a reader's read markers. */
const APP_DATA_KIND = 30078
const SEEN_IDENTIFIER = 'nostrich/seen'
const MARKER_TIMEOUT_MS = 5_000

/** One of the reader's accounts, and its key if we hold. */
export interface WatchedAccount {
  pubkey: Hex
  signer?: Signer
}

export interface AccountAlerts {
  notifications: boolean
  zaps: boolean
  chats: boolean
}

const EMPTY: AccountAlerts = { notifications: false, zaps: false, chats: false }

const flags = new Map<Hex, { notifications: boolean; zaps: boolean }>()
const listeners = new Set<() => void>()
let version = 0

function emit(): void {
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  /* A wrap arriving has to move OUR version, not just chat-alerts'. */
  const stop = subscribeChatWraps(() => {
    version += 1
    listener()
  })
  return () => {
    listeners.delete(listener)
    stop()
  }
}

/** That account's read marker, as it stands on this device. */
function marker(pubkey: Hex, base: string): number {
  const raw = Number(scopedRecord(base, pubkey)?.v)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

/** Anything older than this is not news for that account. */
function since(pubkey: Hex, base: string): number {
  const read = marker(pubkey, base)
  return read > 0 ? read : firstLookAt(pubkey)
}

/** The dots for one account. */
export function useAccountAlerts(pubkey: Hex | undefined): AccountAlerts {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )
  if (pubkey === undefined || typeof window === 'undefined') return EMPTY
  const held = flags.get(pubkey)
  return {
    notifications: held?.notifications ?? false,
    zaps: held?.zaps ?? false,
    chats: unreadChatWraps(pubkey) > 0,
  }
}

/** True when ANY of the accounts passed has something waiting. */
export function useAnyAccountAlerts(pubkeys: readonly Hex[]): boolean {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )
  if (typeof window === 'undefined') return false
  return pubkeys.some(pubkey => {
    const held = flags.get(pubkey)
    return held?.notifications === true || held?.zaps === true || unreadChatWraps(pubkey) > 0
  })
}

/** Why each dot lit, kept for the Dev Tools readout. */
export interface AlertReason {
  eventId: string
  kind: number
  author: string
  createdAt: number
  floor: number
}

/** The newest event this watch has counted for each account, kept after it stops. */
const newestCounted = new Map<Hex, { notifications: number; zaps: number }>()

/** THE EVENTS THAT LIT THE DOT, kept so the page does not have to fetch them again. */
const RECENT_PER_ACCOUNT = 30
const recentFor = new Map<Hex, NostrEvent[]>()

/** What the watch saw for this account, newest first. */
export function heldAlertEvents(pubkey: Hex | undefined): NostrEvent[] {
  if (pubkey === undefined) return []
  return [...(recentFor.get(pubkey) ?? [])]
}

function remember(pubkey: Hex, event: NostrEvent): void {
  const held = recentFor.get(pubkey) ?? []
  if (held.some(seen => seen.id === event.id)) return
  recentFor.set(pubkey, [event, ...held].slice(0, RECENT_PER_ACCOUNT))
}

/** PER COLUMN. */
function counted(pubkey: Hex | undefined): { notifications: number; zaps: number } {
  const held = pubkey === undefined ? undefined : newestCounted.get(pubkey)
  return held ?? { notifications: 0, zaps: 0 }
}

/** The newest thing the watch counted for this account, of any kind. */
export function newestKnownFor(pubkey: Hex | undefined): number {
  const held = counted(pubkey)
  return Math.max(held.notifications, held.zaps)
}

/** The newest ZAP the watch counted. */
export function newestZapKnownFor(pubkey: Hex | undefined): number {
  return counted(pubkey).zaps
}

function set(
  pubkey: Hex,
  field: 'notifications' | 'zaps',
  because?: AlertReason,
): void {
  if (because !== undefined) {
    // Outlives the watch on purpose.
    const held = counted(pubkey)
    newestCounted.set(pubkey, { ...held, [field]: Math.max(held[field], because.createdAt) })
  }
  const held = flags.get(pubkey) ?? { notifications: false, zaps: false }
  if (held[field]) return
  flags.set(pubkey, { ...held, [field]: true })
  emit()
}

/** What the OTHER accounts have already read, taken from what they published. */
async function adoptRemoteMarkers(accounts: readonly WatchedAccount[]): Promise<void> {
  const local = accounts.filter(
    (account): account is { pubkey: Hex; signer: Signer } =>
      account.signer !== undefined && account.signer.kind === 'privatekey',
  )
  if (local.length === 0) return

  const events = await getPool().query(
    [
      {
        kinds: [APP_DATA_KIND],
        authors: local.map(account => account.pubkey),
        '#d': [SEEN_IDENTIFIER],
      },
    ] as never,
    undefined,
    MARKER_TIMEOUT_MS,
  )

  /** Relays disagree about which replaceable event is current. */
  const newest = new Map<string, { created_at: number; content: string }>()
  for (const event of events) {
    const held = newest.get(event.pubkey)
    if (held === undefined || event.created_at > held.created_at) newest.set(event.pubkey, event)
  }

  await Promise.all(
    local.map(async account => {
      const event = newest.get(account.pubkey)
      if (event === undefined || event.content.trim() === '') return
      try {
        const payload = parseSeenPayload(await account.signer.nip44Decrypt(account.pubkey, event.content))
        adoptMarker(account.pubkey, NOTIFICATIONS_SEEN_KEY, payload['notifications'], event.created_at)
        adoptMarker(account.pubkey, ZAPS_SEEN_KEY, payload['zaps'], event.created_at)
      } catch {
        // Not ours to read, or nothing readable.
      }
    }),
  )
}

function adoptMarker(pubkey: Hex, base: string, value: unknown, at: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return
  if (value <= marker(pubkey, base)) return
  applyScoped(base, String(Math.floor(value)), at, pubkey)
}

/** Watches every account that is not the one in front. */
/** P-tags past which a note is a broadcast rather than a mention. */
const MAX_TAGGED = MAX_ROOT_PTAGS

/** The full event, not the five fields this watch used to declare. */
type WatchedEvent = NostrEvent

/** How long to gather e-tagged candidates before asking the relays who wrote the notes. */
const PARENT_DEBOUNCE_MS = 600
const PARENT_TIMEOUT_MS = 6_000
/** Ids per lookup. */
const MAX_PARENTS = 200
/** Candidates held while that lookup is in flight. */
const MAX_DEFERRED = 300

export function useAccountAlertsWatch(others: readonly WatchedAccount[]): void {
  // A stable dependency: the array identity changes on every render of the provider.
  const key = others.map(account => account.pubkey).join(',')
  /** Kept in a ref rather than a dependency: signers are objects, and identity churns. */
  const accountsRef = useRef(others)
  accountsRef.current = others

  useEffect(() => {
    const watching = key === '' ? [] : (key.split(',') as Hex[])
    if (watching.length === 0) {
      // Down to one account.
      if (flags.size > 0) {
        flags.clear()
        emit()
      }
      return
    }

    for (const pubkey of [...flags.keys()]) {
      if (!watching.includes(pubkey)) flags.delete(pubkey)
    }

    /** Which of the watched accounts an event is addressed. */
    const addressees = (tags: string[][]): Hex[] =>
      tags
        .filter(tag => tag[0] === 'p' && tag[1] !== undefined && watching.includes(tag[1] as Hex))
        .map(tag => tag[1] as Hex)

    const wraps = new Map<Hex, string[]>()
    let flush: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    /** The notes an event is about: NIP-10 replies and a NIP-18 `q` quote. */
    const refIds = (tags: string[][]): string[] =>
      tags
        .filter(tag => (tag[0] === 'e' || tag[0] === 'q') && typeof tag[1] === 'string')
        .map(tag => tag[1] as string)

    /** Who wrote each note we have had to ask. */
    const resolved = new Map<string, string | null>()
    let deferred: { event: WatchedEvent; pubkey: Hex }[] = []
    let resolveTimer: ReturnType<typeof setTimeout> | undefined

    const countNote = (event: WatchedEvent, pubkey: Hex): void => {
      const floor = since(pubkey, NOTIFICATIONS_SEEN_KEY)
      if (event.created_at <= floor) return
      // Kept for the handover.
      remember(pubkey, event)
      set(pubkey, 'notifications', {
        eventId: event.id,
        kind: event.kind,
        author: event.pubkey,
        createdAt: event.created_at,
        floor,
      })
    }

    /** The notes we know this account wrote. */
    const ownIds = (pubkey: Hex): ReadonlySet<string> => {
      const ours = new Set<string>(cachedOwnNoteIds(pubkey, ...MINE_KINDS))
      for (const [id, author] of resolved) if (author === pubkey) ours.add(id)
      return ours
    }

    /** Does this account own any of the notes the event is about, as far as we know right. */
    const ownsAny = (pubkey: Hex, targets: readonly string[]): boolean => {
      const ours = ownIds(pubkey)
      return targets.some(id => ours.has(id))
    }

    /** The same judgement as `onEvent`, applied again once a lookup has answered. */
    const recount = (event: WatchedEvent, pubkey: Hex): boolean =>
      event.kind === KINDS.shortNote || event.kind === KINDS.comment
        ? noteNotificationKind(event, pubkey, ownIds(pubkey), threadMentionsEnabledFor(pubkey)) !== null
        : ownsAny(pubkey, refIds(event.tags))

    /** Ask the relays who wrote the notes these replies answer. */
    const resolveParents = async (): Promise<void> => {
      const batch = deferred
      deferred = []
      const ids = [...new Set(batch.flatMap(({ event }) => refIds(event.tags)))]
        .filter(id => !resolved.has(id))
        .slice(0, MAX_PARENTS)
      if (ids.length === 0 || cancelled) return
      let parents: NostrEvent[] = []
      try {
        parents = await getPool().query(
          [{ ids, authors: watching, kinds: MINE_KINDS }] as never,
          undefined,
          PARENT_TIMEOUT_MS,
        )
      } catch {
        // Relays unreachable.
        return
      }
      if (cancelled) return
      for (const parent of parents) {
        // The cache learns it permanently: `cachedOwnNoteIds` answers for this thread.
        rememberEvent(parent)
        resolved.set(parent.id, parent.pubkey)
      }
      // Asked about, and not written by anyone we are watching.
      for (const id of ids) if (!resolved.has(id)) resolved.set(id, null)
      for (const { event, pubkey } of batch) {
        if (recount(event, pubkey)) countNote(event, pubkey)
      }
    }

    const scheduleResolve = (): void => {
      if (resolveTimer !== undefined) return
      resolveTimer = setTimeout(() => {
        resolveTimer = undefined
        void resolveParents()
      }, PARENT_DEBOUNCE_MS)
    }

    const onEvent = (event: WatchedEvent): void => {
      for (const pubkey of addressees(event.tags)) {
        if (event.kind === GIFT_WRAP) {
          // Batched: a relay dumping a backlog fires this hundreds of times, and each one.
          wraps.set(pubkey, [...(wraps.get(pubkey) ?? []), event.id])
          if (flush === undefined) {
            flush = setTimeout(() => {
              flush = undefined
              for (const [viewer, ids] of wraps) recordWraps(viewer, ids)
              wraps.clear()
            }, 400)
          }
          continue
        }
        // Your own note that happens to tag you, or your own repost of yourself.
        if (event.pubkey === pubkey) continue

        /** THE SAME REFUSALS THE PAGE MAKES, or this dot cannot be cleared. */
        // The watch's event has no BODY, so a muted word cannot be judged here.
        if (isMutedContent(event as unknown as NostrEvent)) continue
        // The watch's event shape is narrower than NostrEvent.
        if (isTagSpam(event as unknown as NostrEvent)) continue
        if (isBlockedFromDiscovery(event.pubkey)) continue
        // A note naming this many people is not addressed to any of them.
        if (event.tags.filter(tag => tag[0] === 'p').length > MAX_TAGGED) continue
        if (event.kind === ZAP_RECEIPT || event.kind === NUTZAP_KIND) {
          /* MEASURED AGAINST THE NOTIFICATIONS MARKER, not the wallet's. */
          const floor = since(pubkey, NOTIFICATIONS_SEEN_KEY)
          if (event.created_at > floor) {
            const because = {
              eventId: event.id,
              kind: event.kind,
              author: event.pubkey,
              createdAt: event.created_at,
              floor,
            }
            // Money is the row people most want to see the moment they switch.
            remember(pubkey, event)
            set(pubkey, 'zaps', because)
            set(pubkey, 'notifications', because)
          }
          continue
        }
        /** A THREAD'S p-TAGS ARE NOT AN AUDIENCE. */
        if (event.kind === KINDS.shortNote || event.kind === KINDS.comment) {
          const targets = refIds(event.tags)
          if (noteNotificationKind(event, pubkey, ownIds(pubkey), threadMentionsEnabledFor(pubkey)) === null) {
            // Refused.
            if (targets.length === 0 || targets.every(id => resolved.has(id))) continue
            if (deferred.length < MAX_DEFERRED) deferred.push({ event, pubkey })
            scheduleResolve()
            continue
          }
          countNote(event, pubkey)
          continue
        }

        /** Reposts and reactions are judged by OWNERSHIP alone. */
        const targets = refIds(event.tags)
        if (targets.length > 0 && !ownsAny(pubkey, targets)) {
          // Every id already asked about and none of them ours: settled, drop.
          if (targets.every(id => resolved.has(id))) continue
          if (deferred.length < MAX_DEFERRED) deferred.push({ event, pubkey })
          scheduleResolve()
          continue
        }

        countNote(event, pubkey)
      }
    }

    /** The oldest marker across the accounts watched, so one query serves all of them. */
    const backlogFilters = (): Record<string, unknown>[] => {
      const oldest = Math.min(...watching.map(pubkey => since(pubkey, NOTIFICATIONS_SEEN_KEY)))
      return [
        /** Replies and mentions get their OWN filter, because `limit` is applied per filter. */
        { kinds: [KINDS.shortNote, KINDS.comment], '#p': watching, since: oldest, limit: 40 },
        { kinds: [KINDS.repost, KINDS.reaction], '#p': watching, since: oldest, limit: 30 },
        // Both ways of being paid, exactly as `zapReceiptFilter` asks for them: a lightning.
        { kinds: [ZAP_RECEIPT, NUTZAP_KIND], '#p': watching, since: oldest, limit: 30 },
        // No `since` on wraps: NIP-59 randomises their timestamps by up to two days.
        { kinds: [GIFT_WRAP], '#p': watching, limit: 60 },
      ]
    }

    void (async () => {
      // The markers FIRST, so the backlog below is measured against what each account.
      try {
        await adoptRemoteMarkers(accountsRef.current)
      } catch {
        // Offline, or nothing published.
      }
      if (cancelled) return
      try {
        const events = await getPool().query(backlogFilters() as never, undefined, 8_000)
        if (cancelled) return
        for (const event of events) onEvent(event)
      } catch {
        // Relays unreachable.
      }
    })()

    const handle = getPool().subscribe({
      filters: backlogFilters() as never,
      // `live`: a dot queued behind a screen's own lookups is a dot that lights minutes late.
      live: true,
      onEvent,
    })

    return () => {
      cancelled = true
      if (flush !== undefined) clearTimeout(flush)
      if (resolveTimer !== undefined) clearTimeout(resolveTimer)
      handle.close()
    }
  }, [key])
}
