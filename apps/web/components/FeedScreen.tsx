'use client'

import { Link } from './AppLink'
import { resolveTab, tabFromParam, type FeedTabId } from '../lib/feed-tab'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isReply, KINDS, profileDisplayName, type Hex, type NostrEvent } from '@nostrich/nostr'

import { useFollows } from '../lib/contacts'
import { useCustomFeeds, type CustomFeed } from '../lib/custom-feeds'
import { useFeed, withSelf, type FeedSource } from '../lib/feed'
import { getCachedEvent } from '../lib/event-cache'
import { pluralize } from '../lib/format'
import { normalizeHashtag, noteHref } from '../lib/links'
import { useInteractions } from '../lib/interactions'
import { nextAuthors } from '../lib/stable-authors'
import { mergeTrendingCounts } from '../lib/trending-counts'
import { ownCountsSince, useOwnActionsVersion } from '../lib/own-actions'
import { useUserList } from '../lib/user-lists'

import { prefetchProfiles, useProfile } from '../lib/profiles'
import { isDeleted, useDeletedVersion } from '../lib/deleted'
import { previewableUrl } from '../lib/preview-url'
import { onPublished } from '../lib/published'
import { collapseReposts } from '../lib/repost-collapse'
import { countedId, displayedNote } from '../lib/reposts'
import { claimedByShorterWindow, useShorterWindows, useTrending } from '../lib/trending'
import type { NoteCounts } from '@nostrich/app'
import { manipulatedEngagement } from '../lib/abuse'
import { useReplyFarms } from '../lib/reply-farms'
import { isExcludedFromTrending, isPromotable } from '../lib/spam'
import { onePerAuthor, useProfileGate } from '../lib/quality'
import { collapseBursts } from '../lib/burst'
import { rankByDistance, useSocialGraph } from '../lib/social-graph'
import { findDuplicates } from '../lib/duplicates'
import { verdictFor, type Surface } from '../lib/trust'
import { useTrustContext } from '../lib/use-trust'
import { publishFeedHashtags } from '../lib/trends'
import { publishUnread } from '../lib/unread'
import { BUTTON_QUIET, LINK, SCALED_BODY } from '../lib/styles'
import { Composer } from './Composer'
import { FeedEditor } from './FeedEditor'
import { Avatar } from './Avatar'
import { useNowSeconds } from './Clock'
import { NoteCard } from './NoteCard'
import { hasStoredSession } from '../lib/session-storage'
import { sessionPubkey, useSession } from './SessionProvider'

/** Rows actually mounted. */
const RENDER_CAP = 600
const PAGE_SIZE = 30

/** The gate applies to Latest, where it IS the feed. */

/** Trending windows, shortest first. */
const TRENDING_WINDOWS = [
  { id: '1h', label: 'Trending 1h', hours: 1 },
  { id: '4h', label: 'Trending 4h', hours: 4 },
  { id: '24h', label: 'Trending 24h', hours: 24 },
] as const

/** Just the windows, for the cross-window claim rule. */
const TRENDING_HOURS = TRENDING_WINDOWS.map(window => window.hours)

type TrendingWindowId = (typeof TRENDING_WINDOWS)[number]['id']

/** 4h, not 1h. */
const DEFAULT_WINDOW: TrendingWindowId = '4h'

function windowFromParam(raw: string | null): TrendingWindowId {
  return TRENDING_WINDOWS.some(w => w.id === raw) ? (raw as TrendingWindowId) : DEFAULT_WINDOW
}

const EMPTY_EVENTS: NostrEvent[] = []

function hrefFor(tab: Exclude<FeedTabId, 'custom'>, window?: TrendingWindowId): string {
  return tab === 'trending' ? `/?feed=trending&w=${window ?? DEFAULT_WINDOW}` : `/?feed=${tab}`
}

/** The second tab is a picker, and what is in it depends on whether the reader. */
type DiscoverChoice = 'latest' | TrendingWindowId

function discoverOptions(signedIn: boolean): { id: DiscoverChoice; label: string }[] {
  const windows = TRENDING_WINDOWS.map(w => ({ id: w.id as DiscoverChoice, label: w.label }))
  return signedIn ? [{ id: 'latest', label: 'Latest' }, ...windows] : windows
}

function discoverHref(choice: DiscoverChoice): string {
  return choice === 'latest' ? hrefFor('latest') : hrefFor('trending', choice)
}

/** Custom feeds carry their id in the URL, so a feed is a link somebody can bookmark. */
function customHref(id: string): string {
  return `/?feed=custom&id=${encodeURIComponent(id)}`
}

/** Order a window's notes by how much the network engaged with them. */
/** Loading placeholder for the timeline. */
function Skeleton(): React.ReactNode {
  // Deterministic, not random: a random width per render would reflow.
  const widths = ['92%', '78%', '85%', '60%', '88%', '72%', '95%', '66%', '81%', '90%', '70%', '84%']
  return (
    <div aria-hidden="true">
      {widths.map((width, row) => (
        <div key={row} className="flex gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="size-11 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-32 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
            <div className="h-3 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" style={{ width }} />
            <div
              className="h-3 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none"
              style={{ width: `${Math.max(40, parseInt(width, 10) - 25)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Held-note authors whose profiles are fetched ahead of the reveal. */
/** Stable empty list, so holding the trending tab does not re-key every render. */
const EMPTY_NOTES: readonly NostrEvent[] = []

/** Stable empty list, so the farm sweep is not re-keyed on every render off. */
const EMPTY_IDS: Hex[] = []

const PREFETCH_AUTHORS = 80

/** How many WAITING notes get their interaction counts fetched before the reader. */
const PREFETCH_COUNTS = 40

/** How many waiting notes get their link PREVIEW unfurled. */
const PREFETCH_MEDIA = 12

/** `active`. */
export function FeedScreen({ active = true }: { active?: boolean } = {}): React.ReactNode {
  const searchParams = useSearchParams()
  // Path AND query: a hashtag lives in the path, a tab lives in the query, and two.
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { session, ready, locked } = useSession()
  const pubkey = sessionPubkey(session)
  /** Signed in, including the frames before the session has finished restoring. */
  const signedIn = pubkey !== undefined || locked.length > 0 || (!ready && hasStoredSession())

  const tag = normalizeHashtag(searchParams.get('t'))
  const requested = tabFromParam(searchParams.get('feed'))

  // Contacts are loaded both to build the follows feed and to decide the default.
  const needsFollows = signedIn && (requested === null || requested === 'follows')
  const follows = useFollows(needsFollows ? pubkey : undefined)

  const trendingWindow = windowFromParam(searchParams.get('w'))

  // The reader's own feeds.
  const customFeeds = useCustomFeeds()
  const requestedFeedId = searchParams.get('id')
  const activeFeed =
    requested === 'custom' && requestedFeedId !== null
      ? customFeeds.feeds.find(f => f.id === requestedFeedId)
      : undefined
  /** A custom route pointing at a feed that is not here: just deleted, or a link pasted. */
  const customMissing = requested === 'custom' && customFeeds.ready && activeFeed === undefined

  const tab: FeedTabId = resolveTab({
    requested,
    signedIn,
    customMissing,
    // `follows.loading` counts as HAVING a list.
    hasFollows: follows.authors.length > 0 || follows.loading,
  })

  // Global trending, from a network-wide index.
  const trendingHours =
    TRENDING_WINDOWS.find(w => w.id === trendingWindow)?.hours ?? TRENDING_WINDOWS[0].hours
  const trending = useTrending(trendingHours, tab === 'trending')
  // Every window shorter than this one, so a note already claimed by a faster tab can.
  const shorterWindows = useShorterWindows(trendingHours, TRENDING_HOURS, tab === 'trending')
  const trendingRank = useMemo(() => {
    const rank = new Map<string, number>()
    trending.entries.forEach(entry => rank.set(entry.id, entry.score))
    return rank
  }, [trending.entries])

  /** Counts for the trending tab, taken from the index rather than tallied locally. */
  const trendingCounts = useMemo(() => {
    const map = new Map<string, NoteCounts>()
    for (const e of trending.entries) {
      map.set(e.id, {
        replies: e.replies,
        reposts: e.reposts,
        likes: e.reactions,
        zapSats: e.zapSats,
      })
    }
    return map
  }, [trending.entries])
  const trendingIds = useMemo(() => trending.entries.map(e => e.id), [trending.entries])

  /** The follow list the timeline is built from, held steady while it is on screen. */
  const authorsKey = `${pubkey ?? ''}|${tab}|${tag ?? ''}|${requestedFeedId ?? ''}`
  const heldAuthorsRef = useRef<{ key: string; authors: readonly Hex[] } | undefined>(undefined)
  const stableAuthors = useMemo(() => {
    const held = heldAuthorsRef.current
    const authors = nextAuthors(
      held?.authors,
      follows.authors,
      held === undefined || held.key !== authorsKey,
    ) as readonly Hex[]
    heldAuthorsRef.current = { key: authorsKey, authors }
    return authors
  }, [authorsKey, follows.authors])

  const source = useMemo<FeedSource>(() => {
    if (tag !== null) return { kind: 'hashtag', tag }
    switch (tab) {
      case 'follows':
        // The reader included.
        return { kind: 'authors', authors: withSelf(stableAuthors, pubkey) }
      case 'latest':
        return { kind: 'verified' }
      case 'trending':
        return { kind: 'trending', hours: trendingHours, ids: trendingIds }
      case 'custom':
        return {
          kind: 'custom',
          hashtags: activeFeed?.hashtags ?? [],
          authors: activeFeed?.authors ?? [],
        }
    }
  }, [tag, tab, stableAuthors, pubkey, trendingHours, trendingIds, activeFeed])

  // Held back until the follow list lands, otherwise discover flashes in and is torn.
  const waitingOnFollows = needsFollows && follows.loading
  const followsEmpty = tab === 'follows' && follows.resolved && follows.authors.length === 0
  // Same reasoning for custom feeds: subscribing before storage has been read would.
  const waitingOnCustom = requested === 'custom' && !customFeeds.ready
  /** The two tabs that are THIS READER'S timeline, where their own note belongs. */
  const ownNotesOf = tag === null && (tab === 'follows' || tab === 'latest') ? pubkey : undefined

  const feed = useFeed(
    source,
    active && !waitingOnFollows && !followsEmpty && !waitingOnCustom,
    ownNotesOf === undefined ? undefined : { ownNotesOf },
  )

  // Follows are exempt from every quality rule, deliberately: you decided to follow.

  // Custom feeds are exempt for the same reason.
  const gated = tag !== null || (tab !== 'follows' && tab !== 'custom')
  // Neither of these is a preference any more.

  // Hiding profileless accounts was a toggle, defaulted on, and switching it off.

  // A NIP-05 check implies the profile check anyway: both facts come out of the same.

  // ── TRENDING IS NOT NIP-05 GATED ────────────────────────────────────────────────.

  // Latest is the raw firehose and the check IS the feed there.

  // It was also the only trending surface that gated.
  const requireNip05 = tab === 'latest'
  const gateEnabled = gated

  const gateInput = useMemo(
    () => (gateEnabled ? [...feed.notes, ...feed.pending] : EMPTY_EVENTS),
    [gateEnabled, feed.notes, feed.pending],
  )
  const gate = useProfileGate(gateInput, {
    enabled: gateEnabled,
    requireNip05,
    /* YOUR OWN NOTES ARE NEVER GATED. */
    ...(pubkey === undefined ? {} : { alwaysAllow: pubkey }),
  })

  // Ranked, not filtered.
  /* BUILT ON EVERY TAB, not only where it is used for ranking. */
  /** The clock, at minute resolution. */
  const minute = Math.floor(useNowSeconds() / 60)
  /* Which trending candidates were pushed there by fresh keys with no history. */
  const replyFarms = useReplyFarms(
    tab === 'trending' ? trendingIds : EMPTY_IDS,
    trendingCounts,
    tab === 'trending',
  )
  const socialGraph = useSocialGraph(pubkey)
  const trust = useTrustContext(pubkey, socialGraph)

  /** Mutes, applied. */
  const muted = useUserList('muted')
  const mutedReposts = useUserList('mutedReposts')
  // The signal that a delete happened.
  const deletedVersion = useDeletedVersion()

  /** A per-session bypass, offered by the "hidden notes" report under the feed. */
  const [showHidden, setShowHidden] = useState(false)

  /** WHAT THE TAB IS ALLOWED TO SHOW, before any of the reader's own filters. */
  /** Notes the reader published in this session, newest first. */
  const [justPublished, setJustPublished] = useState<readonly string[]>([])
  useEffect(
    () =>
      onPublished(event => {
        if (event.kind !== KINDS.shortNote || isReply(event)) return
        if (pubkey === undefined || event.pubkey !== pubkey) return
        setJustPublished(current => (current.includes(event.id) ? current : [event.id, ...current]))
      }),
    [pubkey],
  )

  const sourceNotes = useMemo(() => {
    if (tab !== 'trending' || trendingIds.length === 0) return feed.notes
    /* NOTHING until the reply-farm sweep has answered. */
    if (!replyFarms.settled) return EMPTY_NOTES
    const fromRelays = new Map(feed.notes.map(note => [note.id, note]))
    const rows = trendingIds.map(id => fromRelays.get(id) ?? getCachedEvent(id))

    const kept = rows.filter((note): note is NostrEvent => note !== undefined)
    // Anything the relays sent that is not in the snapshot.
    /* The reader's own new notes go ABOVE the ranking. */
    const mine = justPublished
      .map(id => feed.notes.find(note => note.id === id))
      .filter((note): note is NostrEvent => note !== undefined)
    const known = new Set([...kept, ...mine].map(note => note.id))
    return [...mine, ...kept, ...feed.notes.filter(note => !known.has(note.id))]
  }, [tab, feed.notes, trendingIds, replyFarms.settled, justPublished])

  const gatedNotes = useMemo(() => {
    const hidden = new Set(muted.members)
    const noReposts = new Set(mutedReposts.members)
    /** THE READER IS NEVER IN THEIR OWN HIDDEN SET. */
    if (pubkey !== undefined) {
      hidden.delete(pubkey)
      noReposts.delete(pubkey)
    }
    const kept = sourceNotes.filter(note => {
      if (isDeleted(note.id)) return false
      // Mute is never bypassed.
      if (!showHidden && !gate.accepts(note)) return false
      if (hidden.has(note.pubkey)) return false
      if (note.kind === KINDS.repost && noReposts.has(note.pubkey)) return false
      // A repost OF a muted account is still that account's words on your screen.
      const inner = displayedNote(note).inner
      return !hidden.has(inner.pubkey)
    })

    /* One note, one row. */
    return collapseReposts(kept)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deletedVersion is the signal
  }, [sourceNotes, gate, muted.members, mutedReposts.members, deletedVersion, showHidden, pubkey])

  /** Local counts feed the action row on Latest and Follows. */
  const countTargets = useMemo(() => {
    const rendered = gatedNotes.slice(0, 60).map(countedId)
    const held = feed.pending.slice(0, PREFETCH_COUNTS).map(countedId)
    // Deduped: a repost and its original share a counted id, and asking twice.
    return [...new Set([...rendered, ...held])]
  }, [tab, gatedNotes, feed.pending])
  /* Trending's NUMBERS come from the network-wide index, so this subscription used. */

  const { counts: localCounts, zaps: noteZaps } = useInteractions(
    countTargets,
    tab === 'trending' ? { zapsOnly: true } : undefined,
  )

  /** Trending notes the index has no entry for, tallied the ordinary way. */
  const unindexed = useMemo(
    () => (tab === 'trending' ? countTargets.filter(id => !trendingCounts.has(id)) : []),
    [tab, countTargets, trendingCounts],
  )
  const { counts: filledCounts } = useInteractions(unindexed)
  /* Index numbers, corrected where our own receipts know better. */
  /* Re-runs the merge whenever the reader likes, reposts or retracts. */
  const ownVersion = useOwnActionsVersion()
  const indexBuiltAt = trending.entries[0]?.builtAt ?? 0
  const counts = useMemo(
    () =>
      tab === 'trending'
        ? mergeTrendingCounts(trendingCounts, localCounts, filledCounts, id =>
            ownCountsSince(id, indexBuiltAt),
          )
        : localCounts,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ownVersion IS the dependency the
    // getter closes.
    [tab, trendingCounts, localCounts, filledCounts, ownVersion, indexBuiltAt],
  )

  const visibleNotes = useMemo(() => {
    if (tab === 'trending') {
      // The index's `hours` parameter is the window over which INTERACTIONS are counted.

      // So the age is enforced here: a note must have been POSTED inside the window as well.
      /* A LIVE cutoff, not one frozen when this memo last ran. */
      const now = minute * 60
      const cutoff = now - trendingHours * 3600
      const ranked = gatedNotes
        .filter(note => note.created_at >= cutoff)
        // Never promoted.
        .filter(note => isPromotable(displayedNote(note).inner))
        /* Accounts kept off the charts and off nothing else. */
        .filter(note => !isExcludedFromTrending(displayedNote(note).inner.pubkey))
        // ONE WINDOW PER NOTE.
        .filter(note => !claimedByShorterWindow(note, shorterWindows, now))
        /* Bought engagement, dropped. */
        .filter(note => manipulatedEngagement(trendingCounts.get(countedId(note))) === undefined)
        /* And the stronger rule, which needs to know WHO replied. */
        .filter(note => !replyFarms.farmed.has(countedId(note)))
        .sort((a, b) => (trendingRank.get(b.id) ?? 0) - (trendingRank.get(a.id) ?? 0))
      /** ONE NOTE PER AUTHOR, and here it is a flatten rather than the collapse Latest uses. */
      /** THE READER'S OWN NEW NOTE SITS ABOVE THE CHART. */
      const chart = onePerAuthor(ranked)
      if (justPublished.length === 0) return chart
      const mineIds = new Set(justPublished)
      const mine = gatedNotes.filter(note => mineIds.has(note.id))
      if (mine.length === 0) return chart
      return [...mine, ...chart.filter(note => !mineIds.has(note.id))]
    }
    /** A hashtag page is discovery, and the loudest account about a tag must not become. */
    if (tag !== null) return gatedNotes
    if (tab !== 'latest') return gatedNotes
    // Latest is discovery too.
    const promotable = gatedNotes.filter(note => isPromotable(displayedNote(note).inner))
    // Rank by social distance first, then collapse bursts.
    return collapseBursts(rankByDistance(promotable, socialGraph))
  }, [
    gatedNotes,
    tab,
    tag,
    socialGraph,
    trendingRank,
    trendingHours,
    shorterWindows,
    minute,
    justPublished,
    replyFarms.farmed,
    trendingCounts,
  ])

  // Hashtags for the right rail, taken from what is actually on screen.
  useEffect(() => {
    publishFeedHashtags(visibleNotes)
  }, [visibleNotes])
  const hiddenCount = sourceNotes.length - visibleNotes.length
  /** How many held notes would ACTUALLY appear if the reader pressed the button. */
  const pendingNotes = useMemo(() => {
    const accepted = feed.pending.filter(gate.accepts)
    if (accepted.length === 0) return accepted
    /* EVERY step the merge will apply, not just the ones Latest adds. */
    const merged = collapseReposts([...accepted, ...gatedNotes])
    const shown =
      tag !== null || tab !== 'latest'
        ? merged
        : collapseBursts(
            rankByDistance(
              merged.filter(note => isPromotable(displayedNote(note).inner)),
              socialGraph,
            ),
          )
    const survivors = new Set(shown.map(note => note.id))
    return accepted.filter(note => survivors.has(note.id))
  }, [feed.pending, gate, tab, tag, gatedNotes, socialGraph])

  const pendingCount = pendingNotes.length
  /** THE PILL DOES NOT APPEAR FOR ONE OR TWO NOTES. */
  const PILL_MIN = 3
  const showPill = pendingCount >= PILL_MIN

  /** Who wrote the waiting notes, newest first, deduped. */
  const pendingAuthors = useMemo(
    () => [...new Set(pendingNotes.map(note => note.pubkey))].slice(0, 3),
    [pendingNotes],
  )

  /** Faces at exactly three notes AND three distinct people. */
  const showFaces = pendingCount === PILL_MIN && pendingAuthors.length >= PILL_MIN

  /** Names and faces for the held notes, fetched while they are still behind the button. */
  const heldAuthorKey = [
    ...new Set(
      // Both ends of a repost: the card names the person reposting AND the person reposted.
      pendingNotes.flatMap(note => [note.pubkey, displayedNote(note).inner.pubkey]),
    ),
  ]
    .slice(0, PREFETCH_AUTHORS)
    .join(',')
  useEffect(() => {
    if (heldAuthorKey === '') return
    void prefetchProfiles(queryClient, heldAuthorKey.split(',') as Hex[])
  }, [heldAuthorKey, queryClient])

  /** Link previews for the waiting notes, unfurled before the reveal. */
  const heldPreviewKey = [
    ...new Set(feed.pending.map(note => previewableUrl(displayedNote(note).inner)).filter(Boolean)),
  ]
    .slice(0, PREFETCH_MEDIA)
    .join(' ')
  useEffect(() => {
    if (heldPreviewKey === '') return
    for (const url of heldPreviewKey.split(' ')) {
      void queryClient.prefetchQuery({
        queryKey: ['unfurl', url],
        queryFn: async (): Promise<unknown> => {
          const response = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
          return response.ok ? await response.json() : { url }
        },
        staleTime: 6 * 60 * 60_000,
      })
    }
  }, [heldPreviewKey, queryClient])

  /** Avatar IMAGES need nothing here: `prefetchProfiles` above already warms them. */

  /** Put the URL back on a feed that exists. */
  useEffect(() => {
    if (customMissing && tab !== 'custom') router.replace(hrefFor(tab))
  }, [customMissing, router, tab])

  // Tell the nav there is something waiting, so Home can show a dot from any route.
  useEffect(() => {
    publishUnread(pendingCount, () => {
      /* The pill means "show me the new notes", and the new notes are at the TOP. */
      feed.reveal()
      showOwnNote()
    })
    // Clearing on unmount stops the dot persisting after the reader navigates away.
    return () => publishUnread(0)
  }, [pendingCount, feed.reveal])

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CustomFeed | null>(null)
  const [addingTag, setAddingTag] = useState(false)

  const [visible, setVisible] = useState(PAGE_SIZE)

  /** TAKE THE READER TO THE NOTE THEY JUST WROTE. */
  const showOwnNote = useCallback(() => {
    if (typeof window === 'undefined') return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' })
  }, [])

  /** The modal composer's route home. */
  useEffect(
    () =>
      onPublished(published => {
        /* ONLY a top-level note. */
        if (published.kind !== KINDS.shortNote) return
        if (isReply(published)) return
        showOwnNote()
      }),
    [showOwnNote],
  )

  const sentinelRef = useRef<HTMLDivElement>(null)
  const countRef = useRef(0)

  useEffect(() => {
    countRef.current = visibleNotes.length
  }, [visibleNotes.length])

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [source])

  /** Reveal another page, and fetch one when there is nothing left to reveal. */
  const loadMoreRef = useRef(feed.loadMore)
  loadMoreRef.current = feed.loadMore

  useEffect(() => {
    const node = sentinelRef.current
    if (node === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (entry === undefined || !entry.isIntersecting) return
        setVisible(current => {
          if (countRef.current > current) return Math.min(current + PAGE_SIZE, RENDER_CAP)
          // Everything held is already on screen, so the next page has to come off the wire.
          loadMoreRef.current()
          return current
        })
      },
      /** 2800px, and it is the number that decides when PICTURES load. */
      { rootMargin: '2000px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const rows = visibleNotes.slice(0, visible)

  /** The people whose notes were REPOSTED, warmed like everyone else on screen. */
  const repostedAuthorKey = useMemo(
    () =>
      [
        ...new Set(
          rows
            .map(note => displayedNote(note))
            .filter(shown => shown.repostedBy !== undefined && shown.inner.pubkey !== shown.repostedBy)
            .map(shown => shown.inner.pubkey),
        ),
      ]
        .slice(0, PREFETCH_AUTHORS)
        .join(','),
    [rows],
  )
  useEffect(() => {
    if (repostedAuthorKey === '') return
    void prefetchProfiles(queryClient, repostedAuthorKey.split(',') as Hex[])
  }, [repostedAuthorKey, queryClient])

  /** What, if anything, to say instead of each note. */
  /** Copy-paste rings, computed over the WHOLE feed store rather than the rendered slice. */
  const duplicates = useMemo(
    () =>
      findDuplicates(feed.notes, {
        exempt: (author: Hex) =>
          author === pubkey || (trust.graphReady && trust.distance(author) <= 1),
      }),
    [feed.notes, pubkey, trust],
  )

  const collapsedRows = useMemo(() => {
    /** Mirrors `gated` above, and must keep mirroring. */
    const surface: Surface =
      tag === null && (tab === 'follows' || tab === 'custom') ? 'curated' : 'discovery'
    const map = new Map<string, string>()
    if (surface === 'curated' || showHidden) return map

    // On a hashtag page, everything after an author's first note folds.
    if (tag !== null) {
      const seen = new Set<Hex>()
      for (const event of rows) {
        const author = displayedNote(event).inner.pubkey
        if (seen.has(author)) map.set(event.id, 'Another note from the same account.')
        else seen.add(author)
      }
    }

    for (const event of rows) {
      if (map.has(event.id)) continue
      const ring = duplicates.get(event.id)
      if (ring !== undefined) {
        // Counted, not accused.
        map.set(event.id, `The same text was posted by ${ring} accounts.`)
        continue
      }
      const verdict = verdictFor(displayedNote(event).inner, trust, surface)
      if (verdict.action !== 'collapse') continue
      // The first reason is the decisive one.
      const reason = verdict.reasons[0]
      if (reason !== undefined) map.set(event.id, reason.text)
    }
    return map
  }, [rows, trust, tab, tag, showHidden, duplicates])
  /** The trending tab is loading until it has NOTES, not until it has the ranking. */
  const trendingIndexReady = tab === 'trending' && trendingIds.length > 0
  const [bodiesTimedOut, setBodiesTimedOut] = useState(false)
  useEffect(() => {
    if (!trendingIndexReady || rows.length > 0) {
      setBodiesTimedOut(false)
      return
    }
    // Long enough to cover a slow relay set, short enough that a reader is not held.
    const timer = setTimeout(() => setBodiesTimedOut(true), 15_000)
    return () => clearTimeout(timer)
    // `trendingIds` identity changes with the window.
  }, [trendingIndexReady, rows.length, trendingHours])

  const trendingBodiesPending = trendingIndexReady && rows.length === 0 && !bodiesTimedOut

  const busy =
    /* Holding for the farm sweep is a WAIT, not an empty feed. */
    (tab === 'trending' && !replyFarms.settled) ||
    feed.loading ||
    waitingOnFollows ||
    waitingOnCustom ||
    gate.settling ||
    trending.loading ||
    trendingBodiesPending

  return (
    <div>
      {/* px-4/sm:px-5 matches the note rows below it: without it the heading sat flush. */}
      {tag !== null ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-lg font-semibold text-text">#{tag}</h2>
          {/* "Back to the feed" went: the nav, the logo and the browser's own back button all. */}
          <button
            type="button"
            onClick={() => setAddingTag(true)}
            className={`${BUTTON_QUIET} inline-flex shrink-0 items-center gap-1.5`}
          >
            <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
              add
            </span>
            Add as a custom feed
          </button>
        </div>
      ) : null}

      {/* ONE sticky block holding the tab strip and the "Show N notes" band. */}
      <div className="chrome-offset sticky top-16 z-30 sm:top-0">
        {/* Equal-width tabs with a short accent underline under the active one. */}
        {/* Opaque, with no backdrop-filter. */}
        {tag === null ? (
          /* The tabs centre on the WHOLE column. */
          /* `chrome-tabs`: the strip slides away with the header instead of staying behind. */
          <div className="chrome-tabs relative border-b border-border bg-bg">
          <div className="no-scrollbar flex overflow-x-auto">
          {/* `min-w-full`, NOT `mx-auto`. */}
          <div className="flex min-w-full">
            {/* Discover first, your own feed second. */}
            <DiscoverTab
              signedIn={signedIn}
              active={tab === 'trending' || (signedIn && tab === 'latest')}
              choice={tab === 'latest' ? 'latest' : trendingWindow}
            />
            {signedIn ? (
              <FeedTab href={hrefFor('follows')} label="Following" active={tab === 'follows'} />
            ) : (
              <FeedTab href={hrefFor('latest')} label="Latest" active={tab === 'latest'} />
            )}
            {customFeeds.feeds.map(item => (
              <FeedTab
                key={item.id}
                href={customHref(item.id)}
                label={item.name}
                active={tab === 'custom' && activeFeed?.id === item.id}
                onEdit={
                  tab === 'custom' && activeFeed?.id === item.id ? () => setEditing(item) : undefined
                }
              />
            ))}
          </div>
          </div>
            {/* `bg-bg` because it now sits OVER the tabs rather than beside them: with enough. */}
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label="New feed"
              title="New feed"
              className="absolute inset-y-0 right-0 z-10 flex shrink-0 cursor-pointer items-center justify-center bg-bg px-4 text-text-muted transition-colors hover:bg-hover hover:text-text"
            >
              <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
                add
              </span>
            </button>
          </div>
        ) : null}

        {/* Its own band, not an overlay. */}
        {showPill ? (
          <div className="chrome-pill flex justify-center border-b border-border bg-bg py-2.5">
            <button
              type="button"
              onClick={feed.reveal}
              // The orange from the logo's sun.
            className={`rounded-full bg-[#f97315] text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 ${
              showFaces ? 'py-1.5 pl-3.5 pr-5' : 'px-5 py-2'
            }`}
            >
              {/* See `showFaces`: three faces at exactly three notes, a count. */}
              {showFaces ? (
                <span className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="text-base leading-none">
                    ↑
                  </span>
                  <span className="flex -space-x-2">
                    {pendingAuthors.map(author => (
                      <PendingAvatar key={author} pubkey={author} />
                    ))}
                  </span>
                  {/* "posted" rather than a count. */}
                  <span>posted</span>
                  <span className="sr-only">
                   , show {pendingCount} {pluralize(pendingCount, 'note', 'notes')}
                  </span>
                </span>
              ) : (
                <>
                  <span aria-hidden="true">↑ </span>
                  Show {pendingCount} {pluralize(pendingCount, 'note', 'notes')}
                </>
              )}
            </button>
          </div>
        ) : null}
      </div>

      {/* The composer sits BELOW the tabs, so the tabs are what stays pinned. */}
      <Composer
        onPublished={event => {
          feed.insert(event)
          showOwnNote()
        }}
        onRejected={feed.remove}
      />

      <section aria-label="Notes" aria-busy={busy}>
        {followsEmpty ? (
          <p className={`px-4 py-8 text-center ${SCALED_BODY} text-text-muted sm:px-5`}>
            This account does not publish a follow list yet, so there is no personal feed to
            build.{' '}
            <Link href={hrefFor('latest')} className={LINK}>
              Try Latest
            </Link>{' '}
            and follow a few people.
          </p>
        ) : rows.length === 0 && busy ? (
          <Skeleton />
        ) : tab === 'custom' && rows.length === 0 && !busy ? (
          <p className={`px-4 py-8 text-center ${SCALED_BODY} text-text-muted sm:px-5`}>
            Nothing yet from the {describeFeed(activeFeed)} in this feed.{' '}
            <button type="button" onClick={() => activeFeed && setEditing(activeFeed)} className={LINK}>
              Edit the feed
            </button>{' '}
            to add more.
          </p>
        ) : tab === 'trending' && rows.length === 0 && !busy ? (
          <p className={`px-4 py-10 text-center ${SCALED_BODY} text-text-muted sm:px-5`}>
            {trending.error !== null
              ? 'The trending index is unreachable right now. Latest still works, because it reads relays directly.'
              : 'Nothing trending here yet. Try a longer window, or check Latest.'}
          </p>
        ) : rows.length === 0 && hiddenCount > 0 ? (
          /* This used to end "Loosen them above to see them", pointing at a toggle. */
          <p className={`px-4 py-8 text-center ${SCALED_BODY} text-text-muted sm:px-5`}>
            <span className="block">
              All {hiddenCount} {hiddenCount === 1 ? 'note' : 'notes'} that arrived{' '}
              {hiddenCount === 1 ? 'is' : 'are'} from accounts with no profile we could find.
            </span>
            <button
              type="button"
              onClick={() => setShowHidden(true)}
              className="mt-2 cursor-pointer underline decoration-border-strong underline-offset-2 hover:text-text"
            >
              Show them anyway
            </button>
          </p>
        ) : rows.length === 0 && tab === 'follows' ? (
          /* A quiet Following feed is the usual reason this is empty, and blaming the relays. */
          <p className={`px-4 py-8 text-center ${SCALED_BODY} text-text-muted sm:px-5`}>
            {/* Two blocks rather than one wrapped sentence: the state and the suggested next step. */}
            <span className="block">
              Nobody you follow has posted recently. You follow{' '}
              {follows.total.toLocaleString()}{' '}
              {pluralize(follows.total, 'account', 'accounts')}.
            </span>
            <span className="block">
              <Link href={hrefFor('trending')} className={LINK}>
                Try Trending
              </Link>{' '}
              to find more people.
            </span>
          </p>
        ) : rows.length === 0 ? (
          <p className={`px-4 py-8 text-center ${SCALED_BODY} text-text-muted sm:px-5`}>
            Nothing came back from the relays.
            {tag === null
              ? ' They may all be unreachable from this network. Check the relay indicator in the header.'
              : ` No recent notes are tagged #${tag}.`}
          </p>
        ) : (
          rows.map(event => (
            // `countedId`, not `event.id`.
            <NoteCard
              key={event.id}
              event={event}
              counts={counts.get(countedId(event))}
              zaps={noteZaps.get(countedId(event))}
              {...(collapsedRows.has(event.id)
                ? { collapsedFor: collapsedRows.get(event.id) }
                : {})}
            />
          ))
        )}
      </section>

      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      {/* Three different endings, because they mean different things to the reader: more. */}
      {rows.length >= RENDER_CAP ? (
        <p className="pb-6 text-center text-xs text-text-faint">
          Showing the {RENDER_CAP} most recent notes. Reload to start a fresh window.
        </p>
      ) : feed.loadingMore ? (
        <p className="pb-6 pt-2 text-center text-xs text-text-faint">Loading older notes…</p>
      ) : feed.exhausted && rows.length > 0 ? (
        <p className="pb-6 pt-2 text-center text-xs text-text-faint">
          {/* Trending is not a relay query and must not claim to be one. */}
          {tab === 'trending'
            ? 'That is the whole chart for this window. Try a longer one, or open Latest.'
            : 'That is everything your relays have for this feed.'}
        </p>
      ) : null}

      {/* Opened from a hashtag page, pre-filled with that tag and named. */}
      {addingTag && tag !== null ? (
        <FeedEditor
          api={customFeeds}
          seedHashtags={[tag]}
          defaultName={`#${tag}`}
          hashtagsOnly
          onClose={() => setAddingTag(false)}
          onCreated={created => router.push(customHref(created.id))}
        />
      ) : null}

      {creating ? (
        <FeedEditor
          api={customFeeds}
          onClose={() => setCreating(false)}
          // Straight to the new feed.
          onCreated={created => router.push(customHref(created.id))}
        />
      ) : null}
      {editing !== null ? (
        <FeedEditor
          api={customFeeds}
          feed={editing}
          // Deliberately does NOT check here whether the feed survived.
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  )
}

/** Names what a feed is actually made of, so its empty state says something useful. */
function describeFeed(feed: CustomFeed | undefined): string {
  const tags = feed?.hashtags.length ?? 0
  const authors = feed?.authors.length ?? 0
  if (tags > 0 && authors > 0) return 'hashtags and accounts'
  if (tags > 0) return pluralize(tags, 'hashtag', 'hashtags')
  if (authors > 0) return pluralize(authors, 'account', 'accounts')
  return 'terms'
}

/** The second tab: Trending's windows, plus Latest once the reader is signed. */
function DiscoverTab({
  signedIn,
  active,
  choice,
}: {
  signedIn: boolean
  active: boolean
  choice: DiscoverChoice
}): React.ReactNode {
  const router = useRouter()
  const options = discoverOptions(signedIn)
  const label = active ? (options.find(o => o.id === choice)?.label ?? 'Trending') : 'Trending'

  return (
    /* Wider floor than the other tabs: "Trending 24h" plus its chevron does not fit. */
    <div className="relative flex min-w-[9.5rem] flex-1 shrink-0 justify-center">
      <Link
        // Inactive, it goes to Trending's default window rather than to whatever the picker.
        href={active ? discoverHref(choice) : hrefFor('trending')}
        aria-current={active ? 'page' : undefined}
        className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap py-3.5 text-[15px] transition-colors hover:bg-bg-inset"
      >
        <span className="relative">
          <span className={active ? 'font-bold text-text' : 'font-medium text-text-muted'}>
            {label}
          </span>
          {/* Under the LABEL only, and exactly its width. */}
          {active ? (
            <span
              aria-hidden="true"
              className="absolute -bottom-3.5 left-0 right-0 h-1 rounded-lg bg-text"
            />
          ) : null}
        </span>
        {/* Sits immediately after the label, at text size, so it reads as part of the word. */}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`size-[18px] shrink-0 ${active ? 'text-text' : 'text-text-muted'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </Link>
      {active ? (
        /* Transparent select over the whole tab: the reader gets their platform's own picker. */
        <select
          aria-label="Feed"
          value={choice}
          onChange={e => router.push(discoverHref(e.target.value as DiscoverChoice))}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {options.map(option => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )
}

/** `flex-1` plus `min-w`: the tabs share the column evenly while there is room. */
const TAB_BOX = 'flex min-w-[7rem] flex-1 shrink-0'
const TAB_INNER =
  'relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap py-3.5 text-[15px] transition-colors hover:bg-bg-inset'

function FeedTab({
  href,
  label,
  active,
  onEdit,
}: {
  href: string
  label: string
  active: boolean
  /** Set on the ACTIVE custom tab only. */
  onEdit?: () => void
}): React.ReactNode {
  /* Under the LABEL and exactly its width, which is what makes this read as X rather. */
  const underline = active ? (
    <span aria-hidden="true" className="absolute -bottom-3.5 left-0 right-0 h-1 rounded-lg bg-text" />
  ) : null

  // An active custom tab becomes the edit control rather than carrying a nested button.
  if (onEdit !== undefined) {
    return (
      <div className={TAB_BOX}>
        <button type="button" onClick={onEdit} aria-current="page" className={TAB_INNER}>
          {/* `truncate` lives on the INNER span. */}
          <span className="relative max-w-[10rem]">
            <span className="block truncate font-bold text-text">{label}</span>
            {underline}
          </span>
          <span className="material-symbols-outlined text-[17px]! text-text-muted" aria-hidden="true">
            tune
          </span>
          <span className="sr-only">Edit this feed</span>
        </button>
      </div>
    )
  }

  return (
    <div className={TAB_BOX}>
      <Link href={href} aria-current={active ? 'page' : undefined} className={TAB_INNER}>
        {/* Truncation on the inner span, positioning on the outer. */}
        <span className="relative max-w-[10rem]">
          <span
            className={`block truncate ${active ? 'font-bold text-text' : 'font-medium text-text-muted'}`}
          >
            {label}
          </span>
          {underline}
        </span>
      </Link>
    </div>
  )
}

/** One face in the pill's stack. */
function PendingAvatar({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const profile = useProfile(pubkey)
  return (
    <span className="rounded-full ring-2 ring-[#f97315]">
      <Avatar
        pubkey={pubkey}
        name={profileDisplayName(profile ?? { pubkey })}
        picture={profile?.picture}
        size="sm"
      />
    </span>
  )
}
