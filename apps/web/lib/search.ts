'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isReply,
  KINDS,
  MAX_FILTERS_PER_REQ,
  SEARCH_RELAYS,
  toPubkey,
  type Filter,
  type Hex,
  type NostrEvent,
} from '@nostrich/nostr'

import { rememberEvents } from './event-cache'
import { getPool } from './pool'
import { resolveEntity } from './entity'
import { isTagSpam } from './spam'
import { isMutedContent } from './muted-content'
import { isMuted } from './user-lists'

/** Note search. */

/** `@name` and `name` are the same search. */
export function stripHandlePrefix(term: string): string {
  return term.trim().replace(/^@+/, '')
}

export interface SearchInput {
  include: string
  /** An npub or nprofile. Notes BY this account. */
  from: string
  /** An npub, or a note id / nevent. */
  to: string
  /** An npub. */
  zappedBy: string
  since: '' | '1h' | '24h' | '7d' | '30d'
}

export interface SearchResult {
  notes: NostrEvent[]
  /** The first page is still out. A later page uses `loadingMore` instead. */
  loading: boolean
  loadingMore: boolean
  /** Every track has run out, so there is genuinely nothing further back. */
  exhausted: boolean
  /** Set when the input cannot be turned into a query at all. */
  error: string | null
  loadMore: () => void
}

const SINCE_SECONDS: Record<Exclude<SearchInput['since'], ''>, number> = {
  '1h': 3600,
  '24h': 86_400,
  '7d': 604_800,
  '30d': 2_592_000,
}

/** Zap receipts are the 9735 kind. */
const ZAP_RECEIPT = 9735

/** Per track, per page. Large enough that the local pass has something to keep. */
const PAGE_LIMIT = 200
const TIMEOUT_MS = 8_000
/** Pages the FALLBACK track may return without a single local match before it gives up. */
const MAX_DRY_PAGES = 3
/** Accumulated notes held across pages. */
const STORE_CAP = 1_200

export function terms(value: string): string[] {
  return stripHandlePrefix(value)
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t !== '')
}

/** `#bitcoin` alone is a tag query, which every relay can answer natively. */
function hashtagOf(include: string): string | undefined {
  const one = include.trim()
  return /^#[\p{L}\p{N}_]+$/u.test(one) ? one.slice(1).toLowerCase() : undefined
}

export interface ParsedSearch {
  want: string[]
  hashtag?: string
  authors?: Hex[]
  /** Replies to this person. */
  toPerson?: Hex
  /** Replies to this note. */
  toNote?: Hex
  zapper?: Hex
  since?: number
  /** Nothing to search. */
  empty: boolean
  error?: string
}

/** The input, turned into the pieces a filter is built. */
export function parseSearch(input: SearchInput, now = Math.floor(Date.now() / 1000)): ParsedSearch {
  const want = terms(input.include)
  const parsed: ParsedSearch = { want, empty: false }

  const tag = hashtagOf(input.include)
  if (tag !== undefined) parsed.hashtag = tag

  if (input.from.trim() !== '') {
    try {
      parsed.authors = [toPubkey(input.from.trim())]
    } catch {
      // A NIP-05 address needs a well-known lookup first.
      return {
        ...parsed,
        empty: true,
        error: input.from.includes('@')
          ? 'Searching by NIP-05 address is not wired up yet. Paste an npub instead.'
          : 'That is not an npub or nprofile.',
      }
    }
  }

  if (input.to.trim() !== '') {
    const value = input.to.trim()
    /* A person or a note. */
    if (/^[0-9a-f]{64}$/i.test(value)) {
      parsed.toNote = value.toLowerCase() as Hex
    } else {
      const person = resolveEntity(value, 'profile')
      const event = resolveEntity(value, 'event')
      if (person?.kind === 'profile') parsed.toPerson = person.hex
      else if (event?.kind === 'event') parsed.toNote = event.hex
      else return { ...parsed, empty: true, error: 'Replying to needs an npub or a note id.' }
    }
  }

  if (input.zappedBy.trim() !== '') {
    const person = resolveEntity(input.zappedBy.trim(), 'profile')
    if (person?.kind !== 'profile') return { ...parsed, empty: true, error: 'Zapped by needs an npub.' }
    parsed.zapper = person.hex
  }

  if (input.since !== '') parsed.since = now - SINCE_SECONDS[input.since]

  parsed.empty =
    want.length === 0 &&
    parsed.authors === undefined &&
    parsed.toPerson === undefined &&
    parsed.toNote === undefined &&
    parsed.zapper === undefined &&
    parsed.since === undefined

  return parsed
}

/** Everything except the text, which is the half a strfry relay can answer. */
function nativeTerms(parsed: ParsedSearch): Filter {
  const filter: Filter = { kinds: [KINDS.shortNote], limit: PAGE_LIMIT }
  if (parsed.authors !== undefined) filter.authors = parsed.authors
  if (parsed.since !== undefined) filter.since = parsed.since
  if (parsed.toPerson !== undefined) filter['#p'] = [parsed.toPerson]
  if (parsed.toNote !== undefined) filter['#e'] = [parsed.toNote]
  // A bare `#tag` query: the tag index answers it exactly, on every relay.
  if (parsed.hashtag !== undefined) filter['#t'] = [parsed.hashtag]
  return filter
}

export interface TrackFilters {
  /** Carries `search`. */
  index?: Filter
  /** Never carries `search`. For the ordinary read relays. */
  fallback?: Filter
  /** Zap receipts, when "zapped by" is set. */
  zaps?: Filter
}

export function buildFilters(
  parsed: ParsedSearch,
  cursors: { index?: number; fallback?: number; zaps?: number },
): TrackFilters {
  if (parsed.empty || parsed.error !== undefined) return {}

  // "Zapped by" is a different question: the candidates are whatever that person.
  if (parsed.zapper !== undefined) {
    const zaps: Filter = { kinds: [ZAP_RECEIPT], '#P': [parsed.zapper], limit: PAGE_LIMIT }
    if (cursors.zaps !== undefined) zaps.until = cursors.zaps
    return { zaps }
  }

  const out: TrackFilters = {}

  if (parsed.want.length > 0) {
    const index: Filter & { search?: string } = { ...nativeTerms(parsed) }
    // The hashtag went in as `#t` for the relays that need.
    delete index['#t']
    index.search = parsed.want.join(' ')
    if (cursors.index !== undefined) index.until = cursors.index
    out.index = index
  }

  const fallback = nativeTerms(parsed)
  if (cursors.fallback !== undefined) fallback.until = cursors.fallback
  out.fallback = fallback

  return out
}

/** The local pass. Applied to every track, whatever the relay claimed to have done. */
export function matches(event: NostrEvent, parsed: ParsedSearch): boolean {
  // Search is a discovery surface, so the tag-stuffing rule applies here as it does.
  if (isMutedContent(event)) return false
  if (isTagSpam(event)) return false

  if (parsed.since !== undefined && event.created_at < parsed.since) return false
  if (parsed.authors !== undefined && !parsed.authors.includes(event.pubkey)) return false

  // `#p` matches a mention as well as a reply, so "replying to" has to be checked.
  if (parsed.toPerson !== undefined && !isReply(event)) return false
  if (parsed.toNote !== undefined && !event.tags.some(tag => tag[0] === 'e' && tag[1] === parsed.toNote)) {
    return false
  }

  if (parsed.hashtag !== undefined) {
    const tagged = event.tags.some(
      tag => tag[0] === 't' && typeof tag[1] === 'string' && tag[1].toLowerCase() === parsed.hashtag,
    )
    if (tagged) return true
  }

  const content = event.content.toLowerCase()
  // EVERY term must be present.
  return parsed.want.every(term => content.includes(term))
}

/** Note ids a set of zap receipts point at, newest receipt first. */
function zappedIds(receipts: readonly NostrEvent[]): Hex[] {
  const ids: Hex[] = []
  const seen = new Set<string>()
  for (const receipt of [...receipts].sort((a, b) => b.created_at - a.created_at)) {
    for (const tag of receipt.tags) {
      if (tag[0] !== 'e' || typeof tag[1] !== 'string' || seen.has(tag[1])) continue
      seen.add(tag[1])
      ids.push(tag[1] as Hex)
    }
  }
  return ids
}

export function useSearch(input: SearchInput, enabled: boolean): SearchResult {
  const [notes, setNotes] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Stringified so the effect re-runs on content, not on object identity.
  const key = JSON.stringify(input)
  const parsed = useMemo(() => parseSearch(input), [key]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Everything gathered so far, across pages and tracks, deduped by id. */
  const storeRef = useRef(new Map<string, NostrEvent>())
  const cursorsRef = useRef<{ index?: number; fallback?: number; zaps?: number }>({})
  const doneRef = useRef({ index: false, fallback: false, zaps: false })
  const dryRef = useRef(0)
  const inFlightRef = useRef(false)
  const parsedRef = useRef(parsed)
  parsedRef.current = parsed

  const commit = useCallback((): void => {
    const held = [...storeRef.current.values()].sort((a, b) => b.created_at - a.created_at)
    const capped = held.slice(0, STORE_CAP)
    if (capped.length < held.length) {
      // Past the cap the oldest are dropped rather than the newest, so the cursor still.
      storeRef.current = new Map(capped.map(event => [event.id, event]))
    }
    setNotes(capped)
    setExhausted(doneRef.current.index && doneRef.current.fallback && doneRef.current.zaps)
  }, [])

  /** One page from every track that still has somewhere to go. */
  const fetchPage = useCallback(async (): Promise<void> => {
    const current = parsedRef.current
    if (current.empty || current.error !== undefined || inFlightRef.current) return

    const filters = buildFilters(current, cursorsRef.current)
    const pool = getPool()
    const jobs: Array<Promise<{ track: 'index' | 'fallback' | 'zaps'; events: NostrEvent[] }>> = []

    if (filters.index !== undefined && !doneRef.current.index) {
      jobs.push(
        pool
          .query([filters.index], [...SEARCH_RELAYS], TIMEOUT_MS)
          .then(events => ({ track: 'index' as const, events })),
      )
    }
    if (filters.fallback !== undefined && !doneRef.current.fallback) {
      jobs.push(
        pool
          .query([filters.fallback], undefined, TIMEOUT_MS)
          .then(events => ({ track: 'fallback' as const, events })),
      )
    }
    if (filters.zaps !== undefined && !doneRef.current.zaps) {
      jobs.push(
        pool
          .query([filters.zaps], undefined, TIMEOUT_MS)
          .then(async receipts => {
            if (receipts.length === 0) return { track: 'zaps' as const, events: [] }
            // The receipt names the note.
            cursorsRef.current.zaps = Math.min(...receipts.map(r => r.created_at)) - 1
            const ids = zappedIds(receipts).slice(0, 500)
            const events = ids.length === 0 ? [] : await pool.query([{ ids }], undefined, TIMEOUT_MS)
            return { track: 'zaps' as const, events }
          }),
      )
    }

    if (jobs.length === 0) {
      doneRef.current = { index: true, fallback: true, zaps: true }
      commit()
      return
    }

    inFlightRef.current = true
    try {
      const settled = await Promise.allSettled(jobs)
      let fresh = 0
      let answered = false

      for (const result of settled) {
        if (result.status !== 'fulfilled') continue
        answered = true
        const { track, events } = result.value

        if (events.length === 0) {
          doneRef.current[track] = true
        } else if (track !== 'zaps') {
          // Just before the oldest of this page, so the next one continues rather than repeating.
          cursorsRef.current[track] = Math.min(...events.map(event => event.created_at)) - 1
          if (events.length < PAGE_LIMIT) doneRef.current[track] = true
        }

        for (const event of events) {
          if (!matches(event, current)) continue
          if (storeRef.current.has(event.id)) continue
          storeRef.current.set(event.id, event)
          fresh += 1
        }
        rememberEvents(events.filter(event => matches(event, current)))
      }

      if (!answered) {
        setError('No relay answered that search.')
      } else {
        setError(null)
        // The fallback track is the only one that can burn pages on nothing.
        dryRef.current = fresh === 0 ? dryRef.current + 1 : 0
        if (dryRef.current >= MAX_DRY_PAGES) doneRef.current.fallback = true
      }
      commit()
    } finally {
      inFlightRef.current = false
      setLoading(false)
      setLoadingMore(false)
    }
  }, [commit])

  useEffect(() => {
    // Everything resets: a new query is a new result set, not more of the old one.
    storeRef.current = new Map()
    cursorsRef.current = {}
    doneRef.current = { index: false, fallback: false, zaps: false }
    dryRef.current = 0
    inFlightRef.current = false
    setNotes([])
    setExhausted(false)
    setLoadingMore(false)

    if (!enabled || parsed.empty) {
      setLoading(false)
      setError(parsed.error ?? null)
      return
    }

    setLoading(true)
    setError(null)
    void fetchPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the content of input
  }, [key, enabled])

  const loadMore = useCallback((): void => {
    if (inFlightRef.current) return
    if (doneRef.current.index && doneRef.current.fallback && doneRef.current.zaps) return
    setLoadingMore(true)
    void fetchPage()
  }, [fetchPage])

  return useMemo(
    () => ({ notes, loading, loadingMore, exhausted, error, loadMore }),
    [notes, loading, loadingMore, exhausted, error, loadMore],
  )
}
