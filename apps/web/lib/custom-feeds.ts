'use client'

import { useSyncExternalStore } from 'react'
import { normalizeHexKey, type Hex } from '@nostrich/nostr'

import { normalizeHashtag } from './links'
import { onScopedChange, readScoped, writeScoped } from './scope'
import { CUSTOM_FEEDS_KEY as KEY } from './settings-keys'

/** Named feeds the reader builds themselves, from any mix of hashtags and accounts. */

/** The old flat pubkey list, before feeds had identity. */
const LEGACY_KEY = 'nostrich:custom-feed'

/** Past this a feed's filters stop fitting in a single REQ. */
export const MAX_TERMS = 40
export const MAX_FEEDS = 12

export interface CustomFeed {
  id: string
  name: string
  hashtags: string[]
  authors: Hex[]
}

export interface CustomFeedsApi {
  feeds: CustomFeed[]
  /** False until the first read has run. */
  ready: boolean
  create: (name: string, seed?: Partial<Omit<CustomFeed, 'id' | 'name'>>) => CustomFeed | null
  update: (id: string, patch: Partial<Omit<CustomFeed, 'id'>>) => void
  remove: (id: string) => void
  /** Add a pubkey to a feed. Used by the profile overflow menu. */
  addAuthor: (id: string, pubkey: Hex) => void
}

interface Snapshot {
  feeds: CustomFeed[]
  ready: boolean
}

const EMPTY: CustomFeed[] = []
/** The snapshot the server renders and the client hydrates. */
const PENDING: Snapshot = { feeds: EMPTY, ready: false }

let state: Snapshot = PENDING
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function setFeeds(feeds: CustomFeed[]): void {
  state = { feeds, ready: true }
  emit()
}

// --------------------------------------------------------------------------- Storage.

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

/** Structural check on one stored feed. */
function isFeed(value: unknown): value is CustomFeed {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    isStringArray(v['hashtags']) &&
    isStringArray(v['authors'])
  )
}

function readRaw(): CustomFeed[] {
  if (typeof window === 'undefined') return EMPTY
  try {
    const raw = readScoped(KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isFeed).map(sanitize) : EMPTY
    }
    return migrateLegacy()
  } catch {
    // Corrupt storage must not take the timeline down.
    return EMPTY
  }
}

/** One-time move of the old flat pubkey array into a named feed. */
function migrateLegacy(): CustomFeed[] {
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy === null) return EMPTY
  localStorage.removeItem(LEGACY_KEY)

  const parsed: unknown = JSON.parse(legacy)
  if (!isStringArray(parsed)) return EMPTY
  const authors = dedupe(parsed.map(normalizeHexKey).filter(isPresent)).slice(0, MAX_TERMS)
  if (authors.length === 0) return EMPTY

  const migrated: CustomFeed[] = [{ id: newId(), name: 'Saved', hashtags: [], authors }]
  writeScoped(KEY, JSON.stringify(migrated))
  return migrated
}

function write(feeds: CustomFeed[]): void {
  if (typeof window === 'undefined') return
  writeScoped(KEY, JSON.stringify(feeds))
}

// ---------------------------------------------------------------------------.

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}

/** Canonical form for one feed's terms. */
function sanitize(feed: CustomFeed): CustomFeed {
  return {
    ...feed,
    name: feed.name.slice(0, 32),
    hashtags: dedupe(feed.hashtags.map(normalizeHashtag).filter(isPresent)).slice(0, MAX_TERMS),
    authors: dedupe(feed.authors.map(normalizeHexKey).filter(isPresent)).slice(0, MAX_TERMS),
  }
}

// ---------------------------------------------------------------------------.

function commit(feeds: CustomFeed[]): void {
  setFeeds(feeds)
  write(feeds)
}

function create(
  name: string,
  seed?: Partial<Omit<CustomFeed, 'id' | 'name'>>,
): CustomFeed | null {
  const trimmed = name.trim()
  if (trimmed === '' || state.feeds.length >= MAX_FEEDS) return null
  // Seeded in one shot rather than created-then-updated.
  const feed = sanitize({
    id: newId(),
    name: trimmed,
    hashtags: seed?.hashtags ?? [],
    authors: seed?.authors ?? [],
  })
  commit([...state.feeds, feed])
  return feed
}

function update(id: string, patch: Partial<Omit<CustomFeed, 'id'>>): void {
  commit(state.feeds.map(feed => (feed.id === id ? sanitize({ ...feed, ...patch }) : feed)))
}

function remove(id: string): void {
  commit(state.feeds.filter(feed => feed.id !== id))
}

function addAuthor(id: string, pubkey: Hex): void {
  const hex = normalizeHexKey(pubkey)
  if (hex === null) return
  const feed = state.feeds.find(f => f.id === id)
  if (feed === undefined || feed.authors.includes(hex)) return
  update(id, { authors: [...feed.authors, hex] })
}

// ---------------------------------------------------------------------------.

/** Another tab changed the list. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && !event.key.startsWith(KEY)) return
  setFeeds(readRaw())
}

/** Feeds are a reader's own shelves, and the shelves belong to the account. */
onScopedChange(base => {
  if (base !== undefined && base !== KEY) return
  setFeeds(readRaw())
})

function subscribe(listener: () => void): () => void {
  const first = listeners.size === 0
  listeners.add(listener)

  if (first) {
    window.addEventListener('storage', onStorage)
    // Read here rather than at module scope: on the server there is no localStorage.

    // Re-read on every first-subscribe, not only the very first: while nothing.
    const stored = readRaw()
    if (!state.ready || JSON.stringify(stored) !== JSON.stringify(state.feeds)) {
      // Deferred so the notification lands after React has finished subscribing, rather.
      queueMicrotask(() => setFeeds(stored))
    }
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

const API = { create, update, remove, addAuthor } as const

export function useCustomFeeds(): CustomFeedsApi {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => PENDING,
  )
  return { feeds: snapshot.feeds, ready: snapshot.ready, ...API }
}
