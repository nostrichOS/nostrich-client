'use client'

import { useSyncExternalStore } from 'react'

/** How many notes are waiting behind the "Show N notes" control. */

let count = 0
/** How to reveal the held notes. */
let reveal: (() => void) | null = null
const listeners = new Set<() => void>()

export function publishUnread(next: number, onReveal?: () => void): void {
  reveal = onReveal ?? null
  if (next === count) return
  count = next
  for (const listener of listeners) listener()
}

/** True when there was something to reveal, so the caller knows whether to navigate. */
export function revealUnread(): boolean {
  if (reveal === null || count === 0) return false
  reveal()
  return true
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUnread(): number {
  return useSyncExternalStore(
    subscribe,
    () => count,
    // Server render: never a dot in the HTML, or it would flash before hydration corrects.
    () => 0,
  )
}
