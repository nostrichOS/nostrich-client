'use client'

import { useEffect, useState } from 'react'
import { KINDS, type Hex, type NostrEvent, type Profile } from '@nostrich/nostr'
import { toEvent, type ServedNote } from '@nostrich/types'

import { engagementScore } from './engagement'
import { rememberEvents } from './event-cache'
import { writeCachedProfile } from './profile-cache'

/** Global trending, served by our own endpoint. */
const OUR_ENDPOINT = '/api/trending'

/** Free tier is 1 request/second. */
const TTL_MS = 120_000

/** How the panel stays current without a reload. */
const POLL_TICK_MS = 60_000
const REFRESH_MS = 5 * 60_000

/** Minimum gap between two requests to their API, in ms. */
const MIN_SPACING_MS = 1_150

/** How old a cached window may be before it is not worth showing at all. */
const STALE_MAX_MS = 60 * 60_000

/** A request the network is not allowed to hang on forever, or the queue behind. */
const REQUEST_TIMEOUT_MS = 12_000

/** The ARTICLES chart's window, as a number of hours: thirty days. */
export const ARTICLE_WINDOW_HOURS = 30 * 24

export interface TrendingEntry {
  /** When the index this entry came from was BUILT (unix seconds). */
  builtAt?: number
  id: Hex
  /** The served row itself, when our own endpoint answered. */
  note?: ServedNote
  replies: number
  reposts: number
  /** Quote subset of `reposts`. */
  quotes: number
  reactions: number
  zapSats: number
  zapCount: number
  /** Our weighting of their global numbers. */
  score: number
}

const score = engagementScore

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** In memory first, then localStorage. */
const cache = new Map<number, { at: number; entries: TrendingEntry[] }>()

/** Bumped on every write to `cache`, so the by-id index below knows when to rebuild. */
let revision = 0

/** How old the copy in hand is, in milliseconds. */
function entriesAgeMs(hours: number): number {
  const held = cache.get(hours)
  return held === undefined ? Number.POSITIVE_INFINITY : Date.now() - held.at
}

function cachedEntries(hours: number): TrendingEntry[] | undefined {
  const held = cache.get(hours)
  if (held !== undefined && Date.now() - held.at < TTL_MS) return held.entries

  return undefined
}

/** The windows the app offers, for lookups that are not tied to a tab. */
const WINDOWS = [1, 4, 24] as const

/** What the index says about one note, if any window we have already fetched mentions. */
export function trendingFloor(id: Hex): TrendingFloor | undefined {
  return floorIndex().get(id)
}

export interface TrendingFloor {
  replies: number
  reposts: number
  /** Quote subset of `reposts`. */
  quotes: number
  reactions: number
  zapSats: number
  zapCount: number
}

let index: { revision: number; map: Map<Hex, TrendingFloor> } | undefined

/** Forgets every cached window and the index built from them. */
export function forgetTrendingCache(): void {
  cache.clear()
  index = undefined
  revision += 1
}

/** Every cached window flattened into one lookup, rebuilt only when a window is written. */
function floorIndex(): Map<Hex, TrendingFloor> {
  if (index !== undefined && index.revision === revision && index.map.size > 0) return index.map
  const map = new Map<Hex, TrendingFloor>()
  for (const hours of WINDOWS) {
    const entries = cachedEntries(hours) ?? staleEntries(hours)
    if (entries === undefined) continue
    for (const entry of entries) {
      const held = map.get(entry.id)
      map.set(
        entry.id,
        held === undefined
          ? {
              replies: entry.replies,
              reposts: entry.reposts,
              // `num`, not the field: a panel cache persisted before quotes existed revives entries.
              quotes: num(entry.quotes),
              reactions: entry.reactions,
              zapSats: entry.zapSats,
              zapCount: entry.zapCount,
            }
          : {
              replies: Math.max(held.replies, entry.replies),
              reposts: Math.max(held.reposts, entry.reposts),
              quotes: Math.max(held.quotes, num(entry.quotes)),
              reactions: Math.max(held.reactions, entry.reactions),
              zapSats: Math.max(held.zapSats, entry.zapSats),
              zapCount: Math.max(held.zapCount, entry.zapCount),
            },
      )
    }
  }
  // Sampled AFTER the loop: `cachedEntries` bumps the revision when it promotes.
  index = { revision, map }
  return map
}

/** The last good copy for this window, however old, up to `STALE_MAX_MS`. */
function staleEntries(hours: number): TrendingEntry[] | undefined {
  const held = cache.get(hours)
  if (held === undefined) return undefined
  if (held.entries.length === 0) return undefined
  return Date.now() - held.at < STALE_MAX_MS ? held.entries : undefined
}

/** A queue of one, spaced so their rate limit is never the reason a panel is empty. */
let nextSlot = 0

async function waitForSlot(): Promise<void> {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + MIN_SPACING_MS
  if (at > now) await new Promise(resolve => setTimeout(resolve, at - now))
}

/** In-flight requests, one per window. */
const pending = new Map<number, Promise<TrendingEntry[]>>()

async function requestWindow(hours: number): Promise<TrendingEntry[]> {
  await waitForSlot()
  try {
    return await load(hours)
  } catch (first) {
    /* A failure here is usually a 429 wearing a CORS error's clothes, and those clear. */
    await waitForSlot()
    try {
      return await load(hours)
    } catch {
      const stale = staleEntries(hours)
      // Returned WITHOUT being re-cached: the next caller must try the network again rather.
      if (stale !== undefined) return stale
      throw first
    }
  }
}

export async function fetchTrending(hours: number, _signal?: AbortSignal): Promise<TrendingEntry[]> {
  const hit = cachedEntries(hours)
  if (hit !== undefined) return hit

  const inFlight = pending.get(hours)
  if (inFlight !== undefined) return inFlight

  const run = requestWindow(hours).finally(() => {
    if (pending.get(hours) === run) pending.delete(hours)
  })
  pending.set(hours, run)
  return run
}

/** Ask our own endpoint first, and take everything it gives. */
async function loadOurs(hours: number): Promise<TrendingEntry[] | undefined> {
  const res = await fetch(`${OUR_ENDPOINT}?hours=${hours}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`trending: HTTP ${res.status}`)
  const body = (await res.json()) as {
    builtAt?: number
    ready?: boolean
    notes?: ServedNote[]
    profiles?: { pubkey: Hex; profile: Profile }[]
  }
  const builtAt = typeof body.builtAt === 'number' ? body.builtAt : 0
  if (body.ready !== true || !Array.isArray(body.notes) || body.notes.length === 0) return undefined

  /* SEED BEFORE RETURNING, and this is the line that makes the panel instant. */
  const events: NostrEvent[] = body.notes.map(toEvent)
  /* ONLY WHOLE EVENTS GO IN THE SHARED CACHE. */
  rememberEvents(events.filter(event => event.kind === KINDS.shortNote))
  for (const entry of body.profiles ?? []) writeCachedProfile(entry.pubkey, entry.profile)

  const entries: TrendingEntry[] = body.notes.map(note => ({
    builtAt,
    id: note.id,
    note,
    replies: num(note.counts?.replies),
    reposts: num(note.counts?.reposts),
    quotes: num(note.counts?.quotes),
    reactions: num(note.counts?.reactions),
    zapSats: num(note.counts?.zapSats),
    zapCount: num(note.counts?.zapCount),
    // Re-scored locally with the same function the server used, so the two cannot drift.
    score: score({
      replies: num(note.counts?.replies),
      reposts: num(note.counts?.reposts),
      quotes: num(note.counts?.quotes),
      reactions: num(note.counts?.reactions),
      zapCount: num(note.counts?.zapCount),
      zapSats: num(note.counts?.zapSats),
    }),
  }))
  entries.sort((a, b) => b.score - a.score)

  cache.set(hours, { at: Date.now(), entries })
  revision += 1
  return entries
}

/** One row of our payload. */
export type { ServedNote }

async function load(hours: number): Promise<TrendingEntry[]> {
  const ours = await loadOurs(hours)
  if (ours !== undefined) return ours
  throw new Error('trending: no snapshot yet')
}

export interface TrendingState {
  entries: TrendingEntry[]
  loading: boolean
  /** Set when the index is unreachable, so the UI can say so instead of showing nothing. */
  error: string | null
}

/** The last list this browser saw, per window. */
const CACHE_PREFIX = 'trending:'
const CACHE_MAX_MS = 6 * 60 * 60_000
/** How long a good list defends itself against a shorter one. */
const SETTLED_MS = 10 * 60_000
/** When each window last produced a list worth keeping. */
const lastGoodAt = new Map<number, number>()

function cached(_hours: number): TrendingEntry[] {
  return []
}

/** The rows on screen, plus THE WINDOW THEY ANSWER. */
interface HeldTrending extends TrendingState {
  /** The `hours` that produced `entries`. */
  window: number | undefined
}

export function useTrending(hours: number, enabled: boolean): TrendingState {
  const [state, setState] = useState<HeldTrending>({
    entries: [],
    loading: enabled,
    error: null,
    window: undefined,
  })

  useEffect(() => {
    if (!enabled) {
      setState({ entries: [], loading: false, error: null, window: undefined })
      return
    }
    const controller = new AbortController()
    /* Paint what we had, immediately, and keep it while the request runs. */
    const held = cached(hours)
    if (held.length > 0 && !lastGoodAt.has(hours)) lastGoodAt.set(hours, Date.now())
    setState(prev => ({
      entries: prev.window === hours && prev.entries.length > 0 ? prev.entries : held,
      loading: true,
      error: null,
      window: hours,
    }))
    /* One request, reused by the poll below so a refresh goes through exactly the same. */
    const load = (): void => {
      fetchTrending(hours, controller.signal)
        .then(entries => {
          /* A SUPERSEDED WINDOW'S ANSWER IS NOT AN ANSWER. */
          if (controller.signal.aborted) return
          /* AN EMPTY ANSWER NEVER REPLACES A LIST. */
          setState(prev => {
            /* NOT JUST EMPTY. */
            const held = prev.window === hours ? prev.entries : []
            const stale = Date.now() - (lastGoodAt.get(hours) ?? 0) > SETTLED_MS
            if (entries.length < held.length && !stale) {
              return { entries: held, loading: false, error: null, window: hours }
            }
            if (entries.length > 0) {
              lastGoodAt.set(hours, Date.now())
              return { entries, loading: false, error: null, window: hours }
            }
            return { entries: held, loading: false, error: null, window: hours }
          })
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          // Keep what is on screen.
          setState(prev => {
            // Same rule as the success path: only this window's own rows are worth keeping.
            const kept = prev.window === hours ? prev.entries : []
            return {
              entries: kept,
              loading: false,
              window: hours,
              error:
                kept.length > 0
                  ? null
                  : err instanceof Error
                    ? err.message
                    : 'could not reach the trending index',
            }
          })
        })
    }

    load()

    /* Due only when the held copy has outlived the worker's own cadence. */
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (entriesAgeMs(hours) > REFRESH_MS) load()
    }, POLL_TICK_MS)

    /* Coming back to a tab is where staleness is actually noticed, so this asks. */
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && entriesAgeMs(hours) > TTL_MS) load()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      controller.abort()
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hours, enabled])

  return state
}

/** ── One note, one window. */
export interface TrendingWindowIds {
  hours: number
  ids: ReadonlySet<Hex>
  /** Where each note placed in this window, 0-based, in the index's own order. */
  ranks: ReadonlyMap<Hex, number>
}

/** Whether a shorter window has a better claim on this note than the window on screen. */
export function claimedByShorterWindow(
  note: { id: Hex; created_at: number },
  shorter: readonly TrendingWindowIds[],
  now: number,
  ownRank?: number,
): boolean {
  return shorter.some(window => {
    if (!window.ids.has(note.id)) return false
    // Too old for that window to draw it, so its claim would strand the note.
    if (note.created_at < now - window.hours * 3600) return false
    if (ownRank === undefined) return true
    const there = window.ranks.get(note.id)
    // Strictly better only: an equal placement goes to the shorter window.
    return there !== undefined && there <= ownRank
  })
}

/** The id sets for every window shorter than the one on screen. */
export function useShorterWindows(
  hours: number,
  allHours: readonly number[],
  enabled: boolean,
): TrendingWindowIds[] {
  const [windows, setWindows] = useState<TrendingWindowIds[]>([])
  // Joined to a string so the effect compares by VALUE.
  const shorter = allHours.filter(candidate => candidate < hours).join(',')

  useEffect(() => {
    if (!enabled || shorter === '') {
      setWindows([])
      return
    }
    const controller = new AbortController()
    const wanted = shorter.split(',').map(Number)
    Promise.all(
      wanted.map(async candidate => {
        const entries = await fetchTrending(candidate, controller.signal)
        return {
          hours: candidate,
          ids: new Set(entries.map(entry => entry.id)),
          // Index order IS the ranking.
          ranks: new Map(entries.map((entry, index) => [entry.id, index])),
        }
      }),
    )
      .then(result => {
        if (!controller.signal.aborted) setWindows(result)
      })
      .catch(() => {
        if (!controller.signal.aborted) setWindows([])
      })
    return () => controller.abort()
  }, [shorter, enabled])

  return windows
}

/** Trending hashtags, derived from the trending notes themselves. */
export interface TrendingTag {
  tag: string
  /** How many of the trending notes carried. */
  notes: number
}

/** How many trending notes to read hashtags. */
const TAG_SAMPLE = 200
const MAX_TAGS = 8
/** One note is a personal tag, not a topic. */
const MIN_NOTES = 2

export function tagsFromEvents(
  events: readonly { tags: readonly (readonly string[])[] }[],
  max: number = MAX_TAGS,
): TrendingTag[] {
  const counts = new Map<string, number>()
  for (const event of events) {
    // One count per note per tag: a note repeating #bitcoin nine times is one note.
    const seen = new Set<string>()
    for (const tag of event.tags) {
      if (tag[0] !== 't') continue
      const value = tag[1]?.toLowerCase().trim()
      if (value === undefined || value === '' || value.length > 64) continue
      if (seen.has(value)) continue
      seen.add(value)
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= MIN_NOTES)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([tag, notes]) => ({ tag, notes }))
}

export const TRENDING_TAG_SAMPLE = TAG_SAMPLE
