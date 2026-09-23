'use client'

import { useSyncExternalStore } from 'react'
import type { Hex } from '@nostrich/nostr'

/** Which of your followers are NEW. */

const PREFIX = 'nostrich:followers-seen:'

/** Whether this account's follower set has been seeded from a WIDE query yet. */
const SEEDED_PREFIX = 'nostrich:followers-seeded:'

/** Pubkeys we have seen following this account, mapped to when we first saw them. */
type Seen = Record<string, number>

/** Followers remembered per account. */
const MAX_ENTRIES = 6_000

/** How fresh a contact list must be for its author to count as a NEW follower. */
const RECENT_LIST_SECONDS = 3 * 24 * 60 * 60

const cache = new Map<string, Seen>()
const listeners = new Set<() => void>()
let version = 0

function load(viewer: Hex): Seen {
  const held = cache.get(viewer)
  if (held !== undefined) return held
  let seen: Seen = {}
  try {
    const raw = localStorage.getItem(PREFIX + viewer)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      seen = parsed as Seen
    }
  } catch {
    // Unreadable or denied.
  }
  cache.set(viewer, seen)
  return seen
}

function persist(viewer: Hex, seen: Seen): void {
  try {
    localStorage.setItem(PREFIX + viewer, JSON.stringify(seen))
  } catch {
    // Private mode, or full.
  }
}

/** Drop the oldest "was already here" entries when the map outgrows its cap. */
function prune(seen: Seen): Seen {
  const keys = Object.keys(seen)
  if (keys.length <= MAX_ENTRIES) return seen
  const known = keys.filter(key => seen[key] === 0)
  const drop = new Set(known.slice(0, keys.length - MAX_ENTRIES))
  const out: Seen = {}
  for (const key of keys) if (!drop.has(key)) out[key] = seen[key] as number
  return out
}

/** Record who is following, and report nothing. */
/** THE FOLLOWER COUNT AS THE THING THAT LICENSES AN ANNOUNCEMENT. */
const COUNT_PREFIX = 'nostrich:follower-count:'
const BUDGET_PREFIX = 'nostrich:follower-budget:'
const MARK_PREFIX = 'nostrich:follower-mark:'
const MARK_AT_PREFIX = 'nostrich:follower-mark-at:'
const SOURCE_PREFIX = 'nostrich:follower-source:'

/** Most that one observation may license, however far the number jumped. */
const MAX_STEP = 10
/** Most that may ever be banked, however long the reader was away. */
const MAX_BANKED = 25
/** Which count this number came. */
export type FollowerCountSource = 'index' | 'relay'

/** How long a number must hold before it is believed. */
const SETTLE_MS: Record<FollowerCountSource, number> = {
  index: 90_000,
  relay: 5 * 60_000,
}

function readNumber(key: string): number | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function noteFollowerCount(
  viewer: Hex | undefined,
  count: number | undefined,
  source: FollowerCountSource,
): void {
  if (viewer === undefined || count === undefined || typeof window === 'undefined') return
  if (!Number.isFinite(count) || count < 0) return

  const now = Date.now()
  const remember = (value: number): void => {
    try {
      localStorage.setItem(MARK_PREFIX + viewer, String(value))
      localStorage.setItem(MARK_AT_PREFIX + viewer, String(now))
      localStorage.setItem(SOURCE_PREFIX + viewer, source)
    } catch {
      /* denied storage. */
    }
  }
  const believe = (value: number): void => {
    try {
      localStorage.setItem(COUNT_PREFIX + viewer, String(value))
    } catch {
      /* as above. */
    }
  }

  let heldSource: string | null = null
  try {
    heldSource = localStorage.getItem(SOURCE_PREFIX + viewer)
  } catch {
    return
  }

  // A different question is being asked.
  if (heldSource !== null && heldSource !== source) {
    remember(count)
    try {
      localStorage.removeItem(COUNT_PREFIX + viewer)
    } catch {
      /* as above. */
    }
    return
  }

  const mark = readNumber(MARK_PREFIX + viewer)
  const markAt = readNumber(MARK_AT_PREFIX + viewer) ?? 0
  const settled = readNumber(COUNT_PREFIX + viewer)

  if (mark === undefined) {
    remember(count)
    return
  }

  if (count !== mark) {
    remember(count)
    if (settled !== undefined && count < settled) believe(count)
    return
  }

  if (now - markAt < SETTLE_MS[source]) return
  if (settled === undefined) {
    believe(count)
    return
  }
  if (count <= settled) return

  const growth = count - settled
  believe(count)
  const banked = readNumber(BUDGET_PREFIX + viewer) ?? 0
  try {
    localStorage.setItem(
      BUDGET_PREFIX + viewer,
      String(Math.min(MAX_BANKED, banked + Math.min(growth, MAX_STEP))),
    )
  } catch {
    // Nothing to do.
  }
}

function readBudget(viewer: Hex): number {
  if (typeof window === 'undefined') return 0
  return Math.max(0, readNumber(BUDGET_PREFIX + viewer) ?? 0)
}

function writeBudget(viewer: Hex, value: number): void {
  try {
    localStorage.setItem(BUDGET_PREFIX + viewer, String(Math.max(0, value)))
  } catch {
    // Ignored for the same reason as above.
  }
}

/** Record follows our own SERVER established, into the same store the rest of the app. */
export function recordServerFollowers(
  viewer: Hex | undefined,
  rows: readonly { pubkey: Hex; at: number }[],
): void {
  if (viewer === undefined || typeof window === 'undefined' || rows.length === 0) return
  const seen = load(viewer)
  let changed = false
  const next: Seen = { ...seen }
  for (const row of rows) {
    // Never downgrades and never re-dates: an entry already here has been counted.
    if (next[row.pubkey] !== undefined) continue
    next[row.pubkey] = row.at
    changed = true
  }
  if (!changed) return
  const pruned = prune(next)
  cache.set(viewer, pruned)
  persist(viewer, pruned)
  version += 1
  for (const listener of listeners) listener()
}

export function observeFollowers(
  viewer: Hex | undefined,
  followers: readonly { pubkey: Hex; listUpdatedAt: number }[],
  /** Authors PROVEN to have been following before we started watching, by their own. */
  alreadyFollowing: ReadonlySet<Hex> = new Set(),
  /** Authors PROVEN not to have been following before, by their own earlier list failing. */
  provenNew: ReadonlySet<Hex> = new Set(),
): void {
  if (viewer === undefined || typeof window === 'undefined') return
  const seen = load(viewer)
  /** Nothing is announced until the store has been seeded WIDELY. */
  const startedWatching = seededAt(viewer)
  const seedComplete = isSeedComplete(viewer)
  const now = Math.floor(Date.now() / 1000)

  let changed = false
  const next: Seen = { ...seen }
  /* Newest list first, because the budget is scarce and ordering decides who gets. */
  const inOrder = [...followers].sort((a, b) => b.listUpdatedAt - a.listUpdatedAt)
  let budget = readBudget(viewer)
  const budgetAtStart = budget
  for (const follower of inOrder) {
    if (next[follower.pubkey] !== undefined) continue
    /** Recorded either way. */
    /** Three conditions, and the middle one is what makes this reliable. */
    /** FOURTH condition, and the only one backed by evidence rather than by absence. */
    /** FIFTH condition, and the one the reported bug turned on: was the seed COMPLETE. */
    /* The timing conditions are asked FIRST and separately, because they gate every path. */
    const fresh =
      startedWatching > 0 &&
      follower.listUpdatedAt > startedWatching &&
      now - follower.listUpdatedAt < RECENT_LIST_SECONDS &&
      !alreadyFollowing.has(follower.pubkey)

    /* Three ways to be allowed to say "followed you": seedComplete. */
    const vouched = seedComplete || provenNew.has(follower.pubkey)
    const licensed = !vouched && fresh && budget > 0
    if (licensed) budget -= 1
    const isNew = fresh && (vouched || licensed)
    next[follower.pubkey] = isNew ? now : 0
    changed = true
  }
  if (budget !== budgetAtStart) writeBudget(viewer, budget)
  if (!changed) return

  const pruned = prune(next)
  cache.set(viewer, pruned)
  persist(viewer, pruned)
  version += 1
  for (const listener of listeners) listener()
}

/** Fill holes the original seed missed, WITHOUT moving the start line. */
export function closeSeedHoles(viewer: Hex | undefined, pubkeys: readonly Hex[]): void {
  if (viewer === undefined || typeof window === 'undefined' || pubkeys.length === 0) return
  const seen = load(viewer)
  let changed = false
  const next: Seen = { ...seen }
  for (const pubkey of pubkeys) {
    if (next[pubkey] !== undefined) continue
    next[pubkey] = 0
    changed = true
  }
  if (!changed) return
  cache.set(viewer, prune(next))
  persist(viewer, cache.get(viewer) ?? next)
  version += 1
  for (const listener of listeners) listener()
}

/** Re-file people already announced who turn out to have been following all along. */
export function retireFalseFollowers(viewer: Hex | undefined, alreadyFollowing: ReadonlySet<Hex>): void {
  if (viewer === undefined || typeof window === 'undefined' || alreadyFollowing.size === 0) {
    return
  }
  const seen = load(viewer)
  let changed = false
  const next: Seen = { ...seen }
  for (const pubkey of alreadyFollowing) {
    if ((next[pubkey] ?? 0) > 0) {
      next[pubkey] = 0
      changed = true
    }
  }
  if (!changed) return
  cache.set(viewer, next)
  persist(viewer, next)
  version += 1
  for (const listener of listeners) listener()
}

/** When the wide seed ran, in seconds, or zero. */
export function seededAt(viewer: Hex | undefined): number {
  if (viewer === undefined || typeof window === 'undefined') return 0
  try {
    const raw = Number(localStorage.getItem(SEEDED_PREFIX + viewer))
    return Number.isFinite(raw) && raw > 0 ? raw : 0
  } catch {
    // Denied storage.
    return 0
  }
}

/** Whether the wide seed has run for this account. */
export function isSeeded(viewer: Hex | undefined): boolean {
  return seededAt(viewer) > 0
}

/** Record everyone currently following, as already-known, and mark the store seeded. */
/** Whether the seed saw every follower, or stopped at its ceiling. */
const COMPLETE_PREFIX = 'nostrich:followers-complete:'

/** Withdraw a completeness claim the seed should not have made. */
export function demoteSeedCompleteness(
  viewer: Hex | undefined,
  listsSeen: number,
  count: number | undefined,
): void {
  if (viewer === undefined || typeof window === 'undefined') return
  if (count === undefined || !Number.isFinite(count)) return
  if (count <= listsSeen) return
  if (!isSeedComplete(viewer)) return
  try {
    localStorage.setItem(COMPLETE_PREFIX + viewer, 'false')
  } catch {
    // Denied storage reads as incomplete anyway.
  }
}

export function isSeedComplete(viewer: Hex | undefined): boolean {
  if (viewer === undefined || typeof window === 'undefined') return false
  try {
    return localStorage.getItem(COMPLETE_PREFIX + viewer) === 'true'
  } catch {
    return false
  }
}

export function seedKnownFollowers(
  viewer: Hex | undefined,
  pubkeys: readonly Hex[],
  complete = true,
): void {
  if (viewer === undefined || typeof window === 'undefined') return
  if (pubkeys.length === 0) return

  const seen = load(viewer)
  const next: Seen = { ...seen }
  for (const pubkey of pubkeys) {
    if (next[pubkey] === undefined) next[pubkey] = 0
  }

  const pruned = prune(next)
  cache.set(viewer, pruned)
  persist(viewer, pruned)
  try {
    localStorage.setItem(SEEDED_PREFIX + viewer, String(Math.floor(Date.now() / 1000)))
    localStorage.setItem(COMPLETE_PREFIX + viewer, String(complete))
  } catch {
    // Unseeded next load too, which repeats the query rather than announcing wrongly.
  }
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const NONE: Record<string, number> = {}

/** When each follower was first seen, for the account given. */
export function readKnownFollowers(viewer: Hex | undefined): Record<string, number> {
  if (viewer === undefined || typeof window === 'undefined') return NONE
  return load(viewer)
}

/** The same map, re-read whenever a new follower is recorded. */
export function useKnownFollowers(viewer: Hex | undefined): Record<string, number> {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )
  return readKnownFollowers(viewer)
}

/** Test seam, and the Dev Tools reset. */
export function forgetFollowers(viewer: Hex): void {
  cache.delete(viewer)
  try {
    localStorage.removeItem(PREFIX + viewer)
    // The marker goes.
    localStorage.removeItem(SEEDED_PREFIX + viewer)
  } catch {
    // Nothing to clean up.
  }
  version += 1
  for (const listener of listeners) listener()
}
