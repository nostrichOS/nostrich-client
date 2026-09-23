'use client'

import { useSyncExternalStore } from 'react'

/** Whether the page is being scrolled right now. */

/** How long after the last scroll event the page counts as still. */
const IDLE_MS = 200

let scrolling = false
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function announce(): void {
  for (const listener of listeners) listener()
}

function onScroll(): void {
  if (!scrolling) {
    scrolling = true
    announce()
  }
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    scrolling = false
    announce()
  }, IDLE_MS)
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('scroll', onScroll, { capture: true })
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      scrolling = false
    }
  }
}

export function useScrolling(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => scrolling,
    // Server render: nothing is scrolling in a document that has not been painted.
    () => false,
  )
}
