'use client'

import { useEffect, useMemo, useReducer } from 'react'
import { SocialGraph } from 'nostr-social-graph'
import { KINDS, type Hex, type NostrEvent } from '@nostrich/nostr'

import { getPool } from './pool'
import { readStoredGraph, writeStoredGraph } from './graph-store'

/** The reader's social graph, used to rank what they see. */

/** Authors per kind-3 filter. Relays silently drop oversized `authors` arrays. */
const AUTHOR_CHUNK = 200

/** NIP-51 mute list. */
const MUTE_LIST = 10_000

/** How far out to crawl. */
const MAX_DISTANCE = 2

/** Beyond this the graph is not worth holding in a browser tab. */
const MAX_FOLLOWS_CRAWLED = 1_000

export interface SocialGraphApi {
  /** Follow distance, or Infinity when the graph has nothing on this pubkey. */
  distance: (pubkey: Hex) => number
  /** People the reader follows who ALSO follow this account, biggest first. */
  mutuals: (pubkey: Hex) => Hex[]
  /** How many accounts in the crawled graph follow this one. */
  followerCount: (pubkey: Hex) => number
  /** True once the distance-2 crawl has settled. */
  ready: boolean
  /** True when the crawl covered EVERY account the reader follows. */
  complete: boolean
  /** Root pubkey the distances are measured from, or undefined when signed out. */
  root: Hex | undefined
}

const OFFLINE: SocialGraphApi = {
  distance: () => Infinity,
  followerCount: () => 0,
  mutuals: () => [],
  ready: false,
  complete: false,
  root: undefined,
}

/** Build a follow graph rooted at `pubkey`, out to MAX_DISTANCE. */
/** One graph per reader, for the whole session. */
interface GraphEntry {
  graph: SocialGraph
  ready: boolean
  complete: boolean
  /** Bumped on every in-place mutation, so memoized consumers recompute. */
  revision: number
}

/** Current reader plus the one before, so switching accounts back does not re-crawl. */
const MAX_ENTRIES = 2

/** How long to wait for an idle moment before starting anyway. */
const IDLE_TIMEOUT_MS = 3_000
/** Safari has no requestIdleCallback. */
const IDLE_FALLBACK_MS = 1_500

const entries = new Map<Hex, GraphEntry>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** The graph for `root`, crawling it if this is the first time anyone asked. */
function ensureGraph(root: Hex): GraphEntry {
  const existing = entries.get(root)
  if (existing !== undefined) return existing

  const entry: GraphEntry = {
    graph: new SocialGraph(root),
    ready: false,
    complete: false,
    revision: 0,
  }
  entries.set(root, entry)
  // Oldest first.
  for (const key of entries.keys()) {
    if (entries.size <= MAX_ENTRIES) break
    entries.delete(key)
  }

  /** Started when the page is idle, not on mount. */
  const start = (): void => {
    void crawl(root, entry)
  }
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback
  if (typeof idle === 'function') idle(start, { timeout: IDLE_TIMEOUT_MS })
  else setTimeout(start, IDLE_FALLBACK_MS)

  return entry
}

async function crawl(root: Hex, entry: GraphEntry): Promise<void> {
  const pool = getPool()
  try {
    /** The stored graph first, and if it is good enough we stop there. */
    const stored = await readStoredGraph(root)
    if (stored !== undefined) {
      try {
        const restored = await SocialGraph.fromBinary(root, stored.bytes)
        entry.graph = restored
        // Restored graphs are always treated as complete: `complete` describes.
        entry.complete = stored.complete
        entry.ready = true
        entry.revision += 1
        notify()
        return
      } catch {
        // Unreadable blob.
      }
    }

    // Round 1.
    const own = await pool.query([{ kinds: [KINDS.contacts, MUTE_LIST], authors: [root] }])
    entry.graph.handleEvent(own as NostrEvent[], true)
    // Distance 1 is already usable, so publish it before the expensive round rather.
    entry.revision += 1
    notify()

    /** SORTED before slicing, and this is not tidiness. */
    const all = [...entry.graph.getFollowedByUser(root)].sort()
    const follows = all.slice(0, MAX_FOLLOWS_CRAWLED)
    entry.complete = all.length <= MAX_FOLLOWS_CRAWLED
    if (follows.length === 0) {
      entry.ready = true
      notify()
      return
    }

    // Round 2.
    const chunks: Hex[][] = []
    for (let i = 0; i < follows.length; i += AUTHOR_CHUNK) {
      chunks.push(follows.slice(i, i + AUTHOR_CHUNK))
    }
    const rounds = await Promise.all(
      chunks.map(chunk =>
        /** `limit` matters here. */
        pool.query([{ kinds: [KINDS.contacts], authors: chunk, limit: chunk.length }]),
      ),
    )

    entry.graph.handleEvent(rounds.flat() as NostrEvent[], true)
    // Required by the library: distances are cached, and ingesting a batch of follow.
    await entry.graph.recalculateFollowDistances()

    entry.revision += 1
    entry.ready = true
    notify()

    // Written after the graph is usable, never before it: persisting is an optimisation.
    void persist(root, entry)
  } catch {
    // A failed crawl still has to settle, or every consumer waits on `ready` forever.
    entry.ready = true
    notify()
  }
}

async function persist(root: Hex, entry: GraphEntry): Promise<void> {
  try {
    const bytes = await entry.graph.toBinary()
    await writeStoredGraph(root, bytes, entry.complete)
  } catch {
    // Serialising or storing failed.
  }
}

export interface SocialGraphOptions {
  /** Whether this caller may START the crawl, as opposed to only reading a graph. */
  eager?: boolean
}

export function useSocialGraph(
  pubkey: Hex | undefined,
  options: SocialGraphOptions = {},
): SocialGraphApi {
  const eager = options.eager ?? true
  const [, bump] = useReducer((n: number) => n + 1, 0)

  // Re-render whenever any graph mutates.
  useEffect(() => {
    listeners.add(bump)
    return () => {
      listeners.delete(bump)
    }
  }, [])

  useEffect(() => {
    if (pubkey === undefined || !eager) return
    ensureGraph(pubkey)
  }, [pubkey, eager])

  const entry = pubkey === undefined ? undefined : entries.get(pubkey)
  const graph = entry?.graph ?? null
  const ready = entry?.ready ?? false
  const complete = entry?.complete ?? false
  const revision = entry?.revision ?? 0

  return useMemo<SocialGraphApi>(() => {
    if (pubkey === undefined || graph === null) return OFFLINE
    return {
      root: pubkey,
      ready,
      complete,
      distance: (target: Hex) => {
        const d = graph.getFollowDistance(target)
        // The library returns a large sentinel for "unreachable".
        return d > MAX_DISTANCE ? Infinity : d
      },
      followerCount: (target: Hex) => graph.followerCount(target),
      mutuals: (target: Hex) => {
        // Never "followed by you".
        const friends = [...graph.followedByFriends(target)].filter(friend => friend !== pubkey)
        /** Sorted by follower count, descending. */
        return friends.sort((a, b) => graph.followerCount(b) - graph.followerCount(a))
      },
    }
    // `revision` is the real dependency.
  }, [pubkey, graph, ready, complete, revision])
}

/** Order notes by how close their author is to the reader, newest-first within a band. */
export function rankByDistance(notes: NostrEvent[], graph: SocialGraphApi): NostrEvent[] {
  if (graph.root === undefined) return notes
  const cache = new Map<string, number>()
  const distanceOf = (pubkey: string): number => {
    const hit = cache.get(pubkey)
    if (hit !== undefined) return hit
    /** YOU ARE NOT A DISCOVERY. */
    const d = pubkey === graph.root ? 1 : graph.distance(pubkey)
    cache.set(pubkey, d)
    return d
  }
  return [...notes].sort((a, b) => {
    const da = distanceOf(a.pubkey)
    const db = distanceOf(b.pubkey)
    if (da !== db) return da - db
    return b.created_at - a.created_at
  })
}
