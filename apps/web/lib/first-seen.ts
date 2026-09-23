'use client'

import { useSyncExternalStore } from 'react'

/** When we first saw a thing, for facts that Nostr records as STATE rather. */

/** v2 drops every bucket written before the start line below existed. */
const PREFIX = 'nostrich:first-seen:v2:'
/** When this browser started watching a bucket. */
const STARTED_PREFIX = 'nostrich:first-seen:started:v2:'

/** Keys mapped to when we first saw them. */
type Seen = Record<string, number>

const cache = new Map<string, Seen>()
const listeners = new Set<() => void>()
let version = 0

function bucket(namespace: string, viewer: string): string {
  return `${PREFIX}${namespace}:${viewer}`
}

function load(key: string): Seen {
  const held = cache.get(key)
  if (held !== undefined) return held
  let seen: Seen = {}
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      seen = parsed as Seen
    }
  } catch {
    // Unreadable or denied.
  }
  cache.set(key, seen)
  return seen
}

/** Drop the oldest "was already here" entries when a bucket outgrows its cap. */
function prune(seen: Seen, max: number): Seen {
  const keys = Object.keys(seen)
  if (keys.length <= max) return seen
  const drop = new Set(keys.filter(key => seen[key] === 0).slice(0, keys.length - max))
  const out: Seen = {}
  for (const key of keys) if (!drop.has(key)) out[key] = seen[key] as number
  return out
}

export interface ObserveOptions {
  /** Entries kept before the unannounced ones start being evicted. */
  max: number
  /** How recently the underlying list must have been written for its entries to count. */
  freshWithin: number
}

/** Record what we can see now. */
export function observeFirstSeen(
  namespace: string,
  viewer: string | undefined,
  entries: readonly { key: string; writtenAt: number }[],
  options: ObserveOptions,
): void {
  if (viewer === undefined || typeof window === 'undefined') return
  const bucketKey = bucket(namespace, viewer)
  const seen = load(bucketKey)
  const now = Math.floor(Date.now() / 1000)
  const startedWatching = startedAt(namespace, viewer, now)

  let changed = false
  const next: Seen = { ...seen }
  for (const entry of entries) {
    if (next[entry.key] !== undefined) continue
    /** Three conditions, and the middle one is what makes this reliable. */
    const isNew =
      startedWatching > 0 &&
      entry.writtenAt > startedWatching &&
      now - entry.writtenAt < options.freshWithin
    next[entry.key] = isNew ? now : 0
    changed = true
  }
  if (!changed) return

  const pruned = prune(next, options.max)
  cache.set(bucketKey, pruned)
  try {
    localStorage.setItem(bucketKey, JSON.stringify(pruned))
  } catch {
    // Private mode, or full.
  }
  version += 1
  for (const listener of listeners) listener()
}

/** When this browser began watching a bucket, in seconds. */
function startedAt(namespace: string, viewer: string, now: number): number {
  const key = STARTED_PREFIX + namespace + ':' + viewer
  try {
    const raw = Number(localStorage.getItem(key))
    if (Number.isFinite(raw) && raw > 0) return raw
    localStorage.setItem(key, String(now))
  } catch {
    // Storage denied.
    return 0
  }
  /* Zero on the run that sets it, so the first pass announces NOTHING. */
  return 0
}

const NONE: Seen = {}

export function readFirstSeen(namespace: string, viewer: string | undefined): Seen {
  if (viewer === undefined || typeof window === 'undefined') return NONE
  return load(bucket(namespace, viewer))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The same map, re-read whenever anything new is recorded. */
export function useFirstSeen(namespace: string, viewer: string | undefined): Seen {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )
  return readFirstSeen(namespace, viewer)
}

/** Test seam, and the Dev Tools reset. */
export function forgetFirstSeen(namespace: string, viewer: string): void {
  const key = bucket(namespace, viewer)
  cache.delete(key)
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to clean up.
  }
  version += 1
  for (const listener of listeners) listener()
}
