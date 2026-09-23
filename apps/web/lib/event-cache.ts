'use client'

import type { Hex, NostrEvent } from '@nostrich/nostr'

import { isDeleted } from './deleted'

/** Every event this session has already seen, keyed by id. */

/** Entries kept. */
const CAP = 3_000

const events = new Map<Hex, NostrEvent>()

/** The handful of events worth surviving a reload, kept on disk. */
const STORE_KEY = 'events:quoted'

/** Kept on disk. */
const STORED_CAP = 300

/** Held for this session only. */
let stored: Map<Hex, NostrEvent> | undefined

function storedEvents(): Map<Hex, NostrEvent> {
  if (stored === undefined) stored = new Map()
  return stored
}

/** Remember these for the session. */
export function rememberEventsPersisted(list: readonly NostrEvent[]): void {
  rememberEvents(list)
  const keep = storedEvents()
  let changed = false
  for (const event of list) {
    if (keep.has(event.id)) continue
    keep.set(event.id, event)
    changed = true
  }
  if (!changed) return
  while (keep.size > STORED_CAP) {
    const oldest = keep.keys().next().value
    if (oldest === undefined) break
    keep.delete(oldest)
  }
}

export function rememberEvent(event: NostrEvent): void {
  if (events.has(event.id)) return
  // Oldest-inserted goes first.
  if (events.size >= CAP) {
    const oldest = events.keys().next().value
    if (oldest !== undefined) events.delete(oldest)
  }
  events.set(event.id, event)
}

export function rememberEvents(list: readonly NostrEvent[]): void {
  for (const event of list) rememberEvent(event)
}

/** Drops both caches, memory and the loaded copy of the stored one. */
export function forgetCachedEvents(): void {
  events.clear()
  stored = undefined
}

/** Synchronous by design. See the note above about why an async lookup would not help. */
export function getCachedEvent(id: Hex | undefined): NostrEvent | undefined {
  // A note the reader deleted must not come back out of the cache.
  if (id === undefined) return undefined
  // A note the reader deleted must not come back out of the cache.
  if (isDeleted(id)) return undefined
  const held = events.get(id)
  if (held !== undefined) return held
  // Off disk, and promoted, so the next reader in this session takes the Map path.
  const fromDisk = storedEvents().get(id)
  if (fromDisk !== undefined) rememberEvent(fromDisk)
  return fromDisk
}

/** Ids of the reader's own notes this session has already seen. */
export function cachedOwnNoteIds(pubkey: Hex | undefined, ...kinds: number[]): Set<string> {
  const out = new Set<string>()
  if (pubkey === undefined) return out
  const wanted = new Set(kinds)
  for (const event of events.values()) {
    if (wanted.has(event.kind) && event.pubkey === pubkey) out.add(event.id)
  }
  return out
}
