'use client'

import { useSyncExternalStore } from 'react'

/** Whether the first client render is over, and stored values may be read again. */

let ready = false
const listeners = new Set<() => void>()

/** Called once, from the shell, after the tree has hydrated. */
export function markHydrated(): void {
  if (ready) return
  ready = true
  for (const listener of listeners) listener()
}

/** Whether a cache read is safe right now. */
export function cacheReadable(): boolean {
  return ready
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Re-renders the caller once hydration completes, so cached values appear. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ready,
    () => false,
  )
}

/** For tests, which render without a shell to mark. */
export function forgetHydrated(): void {
  ready = false
}
