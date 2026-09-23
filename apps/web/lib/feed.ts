'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  KINDS,
  getTagValues,
  isReply,
  nowSeconds,
  parseRepost,
  type Filter,
  type Hex,
  type NostrEvent,
} from '@nostrich/nostr'

import { rememberEvents } from './event-cache'
import { snapshotKey, sourceKey } from './feed-cache'
import { isDeleted } from './deleted'
import { onPublished } from './published'
import { isExcludedFromTrending, isTagSpam } from './spam'
import { isMutedContent } from './muted-content'
import { listMembers, useUserListsVersion } from './user-lists'
import { isMuted, isRepostMuted } from './user-lists'
import { getPool } from './pool'
import { prefersReducedMotion } from './theme'

/** Where a feed's notes come. */
export type FeedSource =
  | { kind: 'verified' }
  /** `hours` is not part of the query. */
  | { kind: 'trending'; hours: number; ids: Hex[] }
  | { kind: 'hashtag'; tag: string }
  /** `include` decides what a reply is worth here. */
  | { kind: 'authors'; authors: Hex[]; include?: 'posts' | 'all' }
  /** A feed the reader assembled: any mix of hashtags and accounts, ORed together. */
  | { kind: 'custom'; hashtags: string[]; authors: Hex[] }

/** Would this feed have shown this note if it had arrived from a relay. */
/** YOUR OWN NOTES BELONG IN YOUR OWN TIMELINE. */
/** Whether this feed shows replies at all. */
/** Whether an arriving batch waits behind "Show N notes" instead of going straight. */
export function holdsArrivals(
  settled: boolean,
  onScreen: number,
  /** Required, not optional: a caller that forgets it would silently restore the old rule. */
  source: FeedSource,
): boolean {
  if (source.kind === 'trending') return false
  return settled && onScreen > 0
}

export function keepsReplies(source: FeedSource): boolean {
  return source.kind === 'authors' && source.include === 'all'
}

export function withSelf(authors: readonly Hex[], self: Hex | undefined): Hex[] {
  if (self === undefined || authors.includes(self)) return [...authors]
  return [self, ...authors]
}

export function belongsInSource(source: FeedSource, event: NostrEvent): boolean {
  switch (source.kind) {
    case 'authors':
      return source.authors.includes(event.pubkey)
    case 'hashtag':
      return hasHashtag(event, source.tag)
    case 'custom':
      // ORed, exactly as the relay filters.
      return (
        source.authors.includes(event.pubkey) ||
        source.hashtags.some(tag => hasHashtag(event, tag))
      )
    case 'trending':
      // A note published a second ago is in nobody's trending index.
      return source.ids.includes(event.id)
    case 'verified':
      // Whether the author holds a verified NIP-05 is not readable from the event.
      return false
  }
}

function hasHashtag(event: NostrEvent, tag: string): boolean {
  const wanted = tag.toLowerCase()
  return event.tags.some(entry => entry[0] === 't' && entry[1]?.toLowerCase() === wanted)
}

export interface FeedApi {
  notes: NostrEvent[]
  /** Notes that arrived after the first page while the reader was scrolled away. */
  pending: NostrEvent[]
  loading: boolean
  /** Fetch the page BEFORE the oldest note held. */
  loadMore: () => void
  /** A page is in flight. */
  loadingMore: boolean
  /** The relays returned nothing older, so there is genuinely no more to show. */
  exhausted: boolean
  reveal: () => void
  insert: (event: NostrEvent) => void
  remove: (id: string) => void
}

/** Hard ceiling on notes held in memory. */
const STORE_CAP = 1200
/** How long a back-page query waits before giving up on the slower relays. */
const PAGE_TIMEOUT_MS = 8_000

/** Events are batched into one state update per tick. */
const FLUSH_MS = 250
const INITIAL_LIMIT = 80
/** The verified feed asks for far more than it will show. */
const VERIFIED_LIMIT = 800

/** Candidate pool for a trending window, before engagement ranking narrows. */
const TRENDING_LIMIT = 400
/** Authors per filter. */
const AUTHOR_CHUNK = 250
/** Filters per REQ. strfry and nostream both refuse a REQ past about ten. */
const MAX_AUTHOR_FILTERS = 10
/** Hashtag filters a custom feed may send. */
const MAX_CUSTOM_TAG_FILTERS = 8
/** Floor on a chunk's share of the budget: the newest notes are never spread evenly. */
const MIN_CHUNK_LIMIT = 50
/** Notes dated in the future sort to the top and stay there forever. */
const FUTURE_SKEW_SECONDS = 15 * 60

/** Shared empty array: a fresh `[]` on every render restarts memoised consumers. */
const EMPTY: NostrEvent[] = []

/** How long after a reveal the pill stays out of the way. */
const REVEAL_SETTLE_MS = 3_000

function sortNotes(events: NostrEvent[]): NostrEvent[] {
  // Ties broken by id so the order is stable across flushes.
  return events.sort((a, b) => (b.created_at - a.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function authorFilters(authors: readonly Hex[]): Filter[] {
  const chunks: Hex[][] = []
  for (let start = 0; start < authors.length && chunks.length < MAX_AUTHOR_FILTERS; start += AUTHOR_CHUNK) {
    chunks.push([...authors.slice(start, start + AUTHOR_CHUNK)])
  }
  if (chunks.length === 0) return []
  // `limit` is per filter, so N chunks with the full limit would pull N pages.
  const limit = Math.max(MIN_CHUNK_LIMIT, Math.ceil(INITIAL_LIMIT / chunks.length))
  // Deletions come with the notes.
  return chunks.map(chunk => ({ kinds: [KINDS.shortNote, KINDS.deletion], authors: chunk, limit }))
}

/** Reposts, as their own request. */
function repostFiltersFor(source: FeedSource): Filter[] {
  const authors =
    source.kind === 'authors' ? source.authors : source.kind === 'custom' ? source.authors : []
  if (authors.length === 0) return []

  const chunks: Hex[][] = []
  const size = AUTHOR_CHUNK * 2
  for (let start = 0; start < authors.length && chunks.length < MAX_AUTHOR_FILTERS; start += size) {
    chunks.push([...authors.slice(start, start + size)])
  }
  const limit = Math.max(MIN_CHUNK_LIMIT, Math.ceil(INITIAL_LIMIT / chunks.length))
  return chunks.map(chunk => ({ kinds: [KINDS.repost], authors: chunk, limit }))
}

function filtersFor(source: FeedSource): Filter[] {
  switch (source.kind) {
    case 'trending':
      // Fetched BY ID.
      return source.ids.length === 0 ? [] : [{ ids: [...source.ids] }]
    case 'verified':
      // Asks for far more than it will show.
      return [{ kinds: [KINDS.shortNote], limit: VERIFIED_LIMIT }]
    case 'hashtag':
      return [{ kinds: [KINDS.shortNote], '#t': [source.tag], limit: INITIAL_LIMIT }]
    case 'authors':
      return authorFilters(source.authors)
    case 'custom': {
      // One filter per hashtag plus the chunked author filters, all in a single REQ.

      // Budgeted per term rather than per filter: a feed of one tag and one account should.
      const tags = source.hashtags.slice(0, MAX_CUSTOM_TAG_FILTERS)
      const authorChunks = authorFilters(source.authors)
      const terms = tags.length + authorChunks.length
      if (terms === 0) return []
      const limit = Math.max(MIN_CHUNK_LIMIT, Math.ceil(INITIAL_LIMIT / terms))
      return [
        ...tags.map(tag => ({ kinds: [KINDS.shortNote], '#t': [tag], limit })),
        ...authorChunks.map(filter => ({ ...filter, limit })),
      ]
    }
  }
}

/** A live kind-1 feed over the pool's read relays. */
export function useFeed(
  source: FeedSource,
  enabled: boolean,
  options?: {
    /** Whose own notes belong here regardless of what the source says. */
    ownNotesOf?: Hex
  },
): FeedApi {
  const key = sourceKey(source)
  // What the subscription is, and what the saved copy is filed.
  const snapKey = snapshotKey(source)
  const [notes, setNotes] = useState<NostrEvent[]>([])
  const [pending, setPending] = useState<NostrEvent[]>(EMPTY)
  const [loading, setLoading] = useState(enabled)

  /** UNMUTING has to fetch. */
  const listsVersion = useUserListsVersion()
  const mutesRef = useRef<string | undefined>(undefined)
  const [unmuted, setUnmuted] = useState(0)
  useEffect(() => {
    const now = new Set([
      ...listMembers('muted').map(pubkey => `m:${pubkey}`),
      ...listMembers('mutedReposts').map(pubkey => `r:${pubkey}`),
    ])
    const before = mutesRef.current
    mutesRef.current = [...now].sort().join(',')
    // The first run establishes the baseline.
    if (before === undefined) return
    if (before.split(',').some(entry => entry !== '' && !now.has(entry))) {
      setUnmuted(count => count + 1)
    }
  }, [listsVersion])

  const notesRef = useRef<NostrEvent[]>(notes)
  const heldRef = useRef<NostrEvent[]>([])
  const bufferRef = useRef<NostrEvent[]>([])
  const idsRef = useRef<Set<string>>(new Set())
  const eoseRef = useRef(false)

  /** Paging state, all in refs. */
  const keyRef = useRef(key)
  keyRef.current = key
  /** The key the notes in hand were actually collected. */
  const savedKeyRef = useRef(key)
  const snapKeyRef = useRef(snapKey)
  snapKeyRef.current = snapKey
  const savedSnapKeyRef = useRef(snapKey)
  const acceptRef = useRef<(event: NostrEvent) => boolean>(() => false)
  const sourceRef = useRef<FeedSource>(source)
  sourceRef.current = source
  const inFlightRef = useRef(false)
  const exhaustedRef = useRef(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  /** Record ids as seen. */
  const reindex = useCallback(() => {
    for (const event of notesRef.current) idsRef.current.add(event.id)
    for (const event of heldRef.current) idsRef.current.add(event.id)
  }, [])

  const commit = useCallback(
    (next: NostrEvent[]) => {
      // Cached here rather than at each arrival site: everything the reader can see passes.
      rememberEvents(next)
      notesRef.current = next.length > STORE_CAP ? next.slice(0, STORE_CAP) : next
      reindex()
      setNotes(notesRef.current)
    },
    [reindex],
  )

  /** Quiet for a moment after the reader catches up. */
  const settleUntilRef = useRef(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const offerPending = useCallback(() => {
    const wait = settleUntilRef.current - Date.now()
    if (wait <= 0) {
      setPending(heldRef.current)
      return
    }
    // Already waiting: the timer reads the pile when it fires, so it needs no rescheduling.
    if (settleTimerRef.current !== undefined) return
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = undefined
      setPending(heldRef.current)
    }, wait)
  }, [])

  useEffect(
    () => () => {
      if (settleTimerRef.current !== undefined) clearTimeout(settleTimerRef.current)
    },
    [],
  )

  const reveal = useCallback(() => {
    const held = heldRef.current
    heldRef.current = []
    settleUntilRef.current = Date.now() + REVEAL_SETTLE_MS
    if (settleTimerRef.current !== undefined) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = undefined
    }
    setPending(EMPTY)
    if (held.length > 0) commit(sortNotes([...held, ...notesRef.current]))
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }
  }, [commit])

  /** Page backwards in time. */
  const loadMore = useCallback(() => {
    if (inFlightRef.current || exhaustedRef.current) return
    const oldest = notesRef.current.at(-1)
    if (oldest === undefined) return

    const source = sourceRef.current
    // Trending is a fixed set of ids from the index, not a window over time.
    if (source.kind === 'trending') {
      exhaustedRef.current = true
      setExhausted(true)
      return
    }

    const filters = filtersFor(source).map(filter => ({ ...filter, until: oldest.created_at - 1 }))
    if (filters.length === 0) return

    inFlightRef.current = true
    setLoadingMore(true)
    void getPool()
      .query(filters, undefined, PAGE_TIMEOUT_MS)
      .then(events => {
        const fresh = events.filter(event => acceptRef.current(event))
        if (fresh.length === 0) {
          exhaustedRef.current = true
          setExhausted(true)
          return
        }
        for (const event of fresh) idsRef.current.add(event.id)
        commit(sortNotes([...notesRef.current, ...fresh]))
      })
      .catch(() => {
        // A failed page is not an exhausted feed.
      })
      .finally(() => {
        inFlightRef.current = false
        setLoadingMore(false)
      })
  }, [commit])

  const insert = useCallback(
    (event: NostrEvent) => {
      if (idsRef.current.has(event.id)) return
      // Unfiltered ON PURPOSE.
      commit(sortNotes([event, ...notesRef.current]))
    },
    [commit],
  )

  /* Read through a ref so the subscription is registered once rather than re-registered. */
  const ownRef = useRef(options?.ownNotesOf)
  ownRef.current = options?.ownNotesOf

  /** A note this reader just published, inserted the moment it is accepted. */
  useEffect(
    () =>
      onPublished(event => {
        /* FEED ROWS ONLY. */
        if (event.kind !== KINDS.shortNote) return
        const source = sourceRef.current
        const mine = ownRef.current !== undefined && event.pubkey === ownRef.current
        if (!mine && !belongsInSource(source, event)) return
        /* A REPLY IS STILL A REPLY WHEREVER IT WAS WRITTEN. */
        if (event.kind === KINDS.shortNote && isReply(event) && !keepsReplies(source)) return
        insert(event)
      }),
    [insert],
  )

  const remove = useCallback(
    (id: string) => {
      heldRef.current = heldRef.current.filter(event => event.id !== id)
      setPending(heldRef.current)
      commit(notesRef.current.filter(event => event.id !== id))
    },
    [commit],
  )

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      /** A DISABLED FEED WHOSE SOURCE HAS CHANGED is showing somebody else's timeline. */
      if (savedKeyRef.current !== keyRef.current && notesRef.current.length > 0) {
        notesRef.current = []
        heldRef.current = []
        bufferRef.current = []
        idsRef.current = new Set()
        // A feed with no rows is a cold open, whatever the previous one had reached.
        eoseRef.current = false
        setNotes([])
        setPending([])
      }
      return
    }

    /** Restored feeds do not start. */
    savedKeyRef.current = keyRef.current
    savedSnapKeyRef.current = snapKeyRef.current
    const restored: NostrEvent[] = []
    // Same reason as the state initializer above: a restore bypasses `commit`, and a note.
    rememberEvents(restored)
    notesRef.current = restored
    heldRef.current = []
    bufferRef.current = []
    idsRef.current = new Set(restored.map(event => event.id))
    /* ROWS ON SCREEN ARE A READING POSITION, however they got there. */
    eoseRef.current = restored.length > 0
    inFlightRef.current = false
    exhaustedRef.current = false
    setNotes(restored.length > 0 ? restored : EMPTY)
    setPending(EMPTY)
    setLoadingMore(false)
    setExhausted(false)
    setLoading(restored.length === 0)

    /** A restored feed asks the relays only for what it is MISSING. */
    const newest = restored[0]?.created_at
    const filters = filtersFor(source).map(filter =>
      newest === undefined ? filter : { ...filter, since: newest },
    )
    if (filters.length === 0) {
      // A REQ with no filters matches nothing on some relays and everything on others.
      setLoading(false)
      return
    }

    const authorSet = source.kind === 'authors' ? new Set(source.authors) : undefined

    // For a custom feed an event qualifies on EITHER axis, so neither can be a hard gate.
    const discovery =
      source.kind === 'hashtag' || source.kind === 'verified' || source.kind === 'trending'
    const keepReplies = keepsReplies(source)

    const customAuthors = source.kind === 'custom' ? new Set(source.authors) : undefined
    const customTags = source.kind === 'custom' ? new Set(source.hashtags) : undefined

    const accept = (event: NostrEvent): boolean => {
      // Reposts only from author feeds.
      const wantsReposts = source.kind === 'authors' || source.kind === 'custom'
      if (event.kind === KINDS.repost) {
        if (!wantsReposts) return false
      } else if (event.kind !== KINDS.shortNote) return false
      if (idsRef.current.has(event.id)) return false
      if (event.created_at > nowSeconds() + FUTURE_SKEW_SECONDS) return false
      /** Mute, on EVERY source including the ones the reader curated. */
      // The reader's own filters.
      if (isMutedContent(event)) return false
      // A repost OF a muted account is still that account's words on your screen.
      if (event.kind === KINDS.repost) {
        // Only the embedded copy is checked, not a fetched one: `accept` is synchronous.
        const inner = parseRepost(event)
        // A repost is a wrapper.
        if (inner !== undefined && isMutedContent(inner)) return false
        if (isRepostMuted(event.pubkey)) return false
      }
      // Replies without their parent are half a conversation.

      // Kind-1 only.
      if (event.kind === KINDS.shortNote && isReply(event) && !keepReplies) return false
      /** Tag-stuffing, on DISCOVERY surfaces only. */
      if (discovery && isTagSpam(event)) return false
      /* The charts-only exclusion, on the TRENDING source alone. */
      if (source.kind === 'trending' && isExcludedFromTrending(event.pubkey)) return false
      // Relays are not obliged to honour a filter, and a personal feed polluted.
      if (authorSet !== undefined && !authorSet.has(event.pubkey)) return false
      if (
        source.kind === 'hashtag' &&
        !getTagValues(event, 't').some(tag => tag.toLowerCase() === source.tag)
      ) {
        return false
      }
      // Union, not intersection: the note is in if its author is listed OR it carries one.
      if (customAuthors !== undefined && customTags !== undefined) {
        const byAuthor = customAuthors.has(event.pubkey)
        const byTag =
          customTags.size > 0 &&
          getTagValues(event, 't').some(tag => customTags.has(tag.toLowerCase()))
        if (!byAuthor && !byTag) return false
      }
      return true
    }
    // Published for loadMore, which must admit back pages on exactly these terms.
    acceptRef.current = accept

    const flush = (): void => {
      const buffered = bufferRef.current
      if (buffered.length === 0) return
      bufferRef.current = []

      // Before EOSE this is still the first page arriving, so it lands directly.

      // The old condition also let notes through whenever the reader was within 40px.
      /* AN EMPTY TIMELINE HAS NO READING POSITION TO PROTECT. */
      if (!holdsArrivals(eoseRef.current, notesRef.current.length, source)) {
        commit(sortNotes([...buffered, ...notesRef.current]))
        return
      }

      /** Only what is genuinely NEWER goes behind the pill. */
      const newest = notesRef.current[0]?.created_at ?? 0
      const fresh: NostrEvent[] = []
      const backfill: NostrEvent[] = []
      for (const event of buffered) {
        if (event.created_at > newest) fresh.push(event)
        else backfill.push(event)
      }

      if (backfill.length > 0) commit(sortNotes([...backfill, ...notesRef.current]))

      if (fresh.length === 0) {
        reindex()
        return
      }
      // Held back rather than spliced in: moving the row someone is reading is the single.
      heldRef.current = sortNotes([...fresh, ...heldRef.current])
      reindex()
      offerPending()
    }

    /** A kind-5 removes what it names, from everywhere this feed holds. */
    const applyDeletion = (event: NostrEvent): void => {
      const targets = new Set(getTagValues(event, 'e'))
      if (targets.size === 0) return

      const gone = (note: NostrEvent): boolean =>
        targets.has(note.id) && note.pubkey === event.pubkey

      const hadNote = notesRef.current.some(gone)
      const hadHeld = heldRef.current.some(gone)
      bufferRef.current = bufferRef.current.filter(note => !gone(note))
      if (hadHeld) {
        heldRef.current = heldRef.current.filter(note => !gone(note))
        setPending(heldRef.current)
      }
      // commit() rewrites the persisted snapshot, which is what stops it coming back.
      if (hadNote) commit(notesRef.current.filter(note => !gone(note)))
    }

    const admit = (event: NostrEvent): void => {
      if (event.kind === KINDS.deletion) {
        applyDeletion(event)
        return
      }
      if (!accept(event)) return
      idsRef.current.add(event.id)
      bufferRef.current.push(event)
    }

    const handle = getPool().subscribe({
      filters,
      // The timeline stays open and new notes arrive down.
      live: true,
      onEvent: admit,
      onEose: () => {
        flush()
        eoseRef.current = true
        setLoading(false)
      },
    })

    // Its own subscription, and deliberately NOT part of the EOSE that ends the loading.
    const repostFilters = repostFiltersFor(source)
    const repostHandle =
      repostFilters.length === 0
        ? undefined
        : getPool().subscribe({ filters: repostFilters, onEvent: admit })

    const interval = setInterval(flush, FLUSH_MS)
    return () => {
      clearInterval(interval)
      handle.close()
      repostHandle?.close()
    }
  }, [source, enabled, commit, reindex, unmuted])

  /** Mute applies to what is ALREADY on screen, not only to what arrives next. */
  const shown = useMemo(
    () =>
      notes.some(event => isMutedContent(event))
        ? notes.filter(event => !isMutedContent(event))
        : notes,
    // `listsVersion` is the point of this dependency list: it is what re-runs the filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes, listsVersion],
  )

  return { notes: shown, pending, loading, loadingMore, exhausted, loadMore, reveal, insert, remove }
}
