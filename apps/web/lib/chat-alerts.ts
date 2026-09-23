'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { giftWrapFilter, type Hex } from '@nostrich/nostr'

import { ownDmRelays } from './chat'
import { getPool } from './pool'

/** "There is a new message". */

const KEY = 'nostrich:chat-wraps-seen:'

/** Wrap ids remembered per account. */
const MAX_IDS = 4_000

interface Seen {
  /** Wrap ids already accounted. */
  ids: string[]
  /** Ids that arrived since the reader last cleared. */
  fresh: string[]
}

const EMPTY: Seen = { ids: [], fresh: [] }

const cache = new Map<string, Seen>()
const listeners = new Set<() => void>()
let version = 0

function load(viewer: Hex): Seen {
  const held = cache.get(viewer)
  if (held !== undefined) return held
  let seen: Seen = EMPTY
  try {
    const raw = localStorage.getItem(KEY + viewer)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as { ids?: unknown; fresh?: unknown }
      seen = {
        ids: Array.isArray(record.ids) ? (record.ids as string[]) : [],
        fresh: Array.isArray(record.fresh) ? (record.fresh as string[]) : [],
      }
    }
  } catch {
    // Unreadable.
  }
  cache.set(viewer, seen)
  return seen
}

function persist(viewer: Hex, seen: Seen): void {
  cache.set(viewer, seen)
  try {
    localStorage.setItem(KEY + viewer, JSON.stringify(seen))
  } catch {
    // Private mode.
  }
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Account these wrap ids for, lighting the dot for the ones that are genuinely new. */
export function recordWraps(pubkey: Hex, ids: readonly string[]): void {
  if (typeof window === 'undefined' || ids.length === 0) return
  const seen = load(pubkey)
  const known = new Set(seen.ids)
  const fresh = ids.filter(id => !known.has(id))
  if (fresh.length === 0) return

  const seeded = seen.ids.length > 0
  persist(pubkey, {
    ids: [...seen.ids, ...fresh].slice(-MAX_IDS),
    fresh: seeded ? [...new Set([...seen.fresh, ...fresh])].slice(-MAX_IDS) : [],
  })
}

/** The unread count outside React, for the rail's per-account dots. */
export function unreadChatWraps(pubkey: Hex | undefined): number {
  if (pubkey === undefined || typeof window === 'undefined') return 0
  return load(pubkey).fresh.length
}

/** The store's change signal, for the same. */
export function subscribeChatWraps(listener: () => void): () => void {
  return subscribe(listener)
}

/** Watch for gift wraps addressed to the reader, app-wide. */
export function useChatWrapWatch(pubkey: Hex | undefined): void {
  useEffect(() => {
    if (pubkey === undefined || typeof window === 'undefined') return

    const arrived = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined

    const commit = (): void => {
      timer = undefined
      if (arrived.size === 0) return
      recordWraps(pubkey, [...arrived])
      arrived.clear()
    }

    let handle: { close(): void } | undefined
    let cancelled = false

    /* THE READER'S OWN DM RELAYS, not the read set. */
    void ownDmRelays(pubkey).then(relays => {
      if (cancelled) return
      handle = getPool().subscribe({
        // No `since`: the wrap timestamps are randomised, so a window would drop real mail.
        filters: [giftWrapFilter(pubkey)],
        relays,
        // See `SubscribeParams.live`.
        live: true,
        onEvent: event => {
          arrived.add(event.id)
          // Batched.
          if (timer === undefined) timer = setTimeout(commit, 400)
        },
      })
    })

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      handle?.close()
    }
  }, [pubkey])
}

/** How many wraps have arrived that the reader has not cleared. */
export function useUnreadChatWraps(pubkey: Hex | undefined): number {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )
  if (pubkey === undefined || typeof window === 'undefined') return 0
  return load(pubkey).fresh.length
}

/** Everything currently in the inbox counts as read. */
export function clearChatWraps(pubkey: Hex | undefined): void {
  if (pubkey === undefined || typeof window === 'undefined') return
  const seen = load(pubkey)
  if (seen.fresh.length === 0) return
  persist(pubkey, { ids: seen.ids, fresh: [] })
}
