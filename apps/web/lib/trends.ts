'use client'

import { useSyncExternalStore } from 'react'
import type { NostrEvent } from '@nostrich/nostr'

/** Hashtag counts taken from whatever is currently in the reader's feed. */

const MAX_TRENDS = 6
/** Below this a tag is noise. */
const MIN_COUNT = 2

export interface Trend {
  tag: string
  count: number
}

let snapshot: Trend[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function publishFeedHashtags(events: readonly NostrEvent[]): void {
  const counts = new Map<string, number>()
  for (const event of events) {
    // One count per note per tag: a note that repeats #bitcoin nine times is one note.
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

  const next = [...counts.entries()]
    .filter(([, count]) => count >= MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TRENDS)
    .map(([tag, count]) => ({ tag, count }))

  // useSyncExternalStore compares snapshots by identity, so an unchanged list must keep.
  if (
    next.length === snapshot.length &&
    next.every((entry, i) => entry.tag === snapshot[i]?.tag && entry.count === snapshot[i]?.count)
  ) {
    return
  }
  snapshot = next
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const EMPTY: Trend[] = []

export function useFeedHashtags(): Trend[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  )
}
