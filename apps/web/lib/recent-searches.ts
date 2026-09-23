'use client'

import { useSyncExternalStore } from 'react'
import type { Hex } from '@nostrich/nostr'

/** The last ten things this reader looked. */

/** v2: the stored shape changed from plain strings to entries. */
const KEY = 'nostrich:recent-searches:v2'
const LEGACY_KEY = 'nostrich:recent-searches'

/** Ten. */
const MAX = 10

export type RecentEntry =
  | { kind: 'query'; term: string }
  | { kind: 'profile'; pubkey: Hex }

/** Stable identity, for de-duplication and for React keys. */
export function recentKey(entry: RecentEntry): string {
  return entry.kind === 'query' ? `q:${entry.term.toLowerCase()}` : `p:${entry.pubkey}`
}

let cached: RecentEntry[] | undefined
const listeners = new Set<() => void>()
let version = 0

function parse(value: unknown): RecentEntry | undefined {
  if (typeof value === 'string') {
    // A v1 entry: every one of them was a query.
    return value.trim() === '' ? undefined : { kind: 'query', term: value }
  }
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Partial<RecentEntry> & { term?: unknown; pubkey?: unknown }
  if (entry.kind === 'query' && typeof entry.term === 'string' && entry.term.trim() !== '') {
    return { kind: 'query', term: entry.term }
  }
  if (entry.kind === 'profile' && typeof entry.pubkey === 'string' && /^[0-9a-f]{64}$/.test(entry.pubkey)) {
    return { kind: 'profile', pubkey: entry.pubkey as Hex }
  }
  return undefined
}

function load(): RecentEntry[] {
  if (cached !== undefined) return cached
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    cached = Array.isArray(parsed)
      ? parsed.map(parse).filter((entry): entry is RecentEntry => entry !== undefined).slice(0, MAX)
      : []
  } catch {
    cached = []
  }
  return cached
}

function save(next: RecentEntry[]): void {
  cached = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private mode.
  }
  version += 1
  for (const listener of listeners) listener()
}

/** Newest first, without duplicates. */
function remember(entry: RecentEntry): void {
  if (typeof window === 'undefined') return
  const key = recentKey(entry)
  save([entry, ...load().filter(held => recentKey(held) !== key)].slice(0, MAX))
}

/** Record a search. */
export function rememberSearch(term: string): void {
  const value = term.trim()
  if (value === '') return
  remember({ kind: 'query', term: value })
}

/** Record a profile the reader opened. */
export function rememberProfileVisit(pubkey: Hex | undefined): void {
  if (pubkey === undefined || !/^[0-9a-f]{64}$/.test(pubkey)) return
  remember({ kind: 'profile', pubkey })
}

export function forgetRecent(entry: RecentEntry): void {
  const key = recentKey(entry)
  save(load().filter(held => recentKey(held) !== key))
}

export function clearSearches(): void {
  save([])
}

/** Drops the in-memory copy so a test reads storage again. */
export function forgetRecentCache(): void {
  cached = undefined
  version += 1
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const NONE: RecentEntry[] = []

export function useRecentSearches(): RecentEntry[] {
  useSyncExternalStore(
    subscribe,
    () => version,
    // The server has no storage and must agree with the first client render.
    () => 0,
  )
  return typeof window === 'undefined' ? NONE : load()
}
