'use client'

import { useSyncExternalStore } from 'react'

/** Files that claim to be video and turn out to be sound. */

const KEY = 'nostrich:audio-only:v1'
/** Enough for a long scroll without letting a browsing history accumulate forever. */
const MAX = 300

const known = new Set<string>()
const listeners = new Set<() => void>()
/** Bumped on every new verdict. */
let version = 0
let loaded = false

function load(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) for (const url of parsed) if (typeof url === 'string') known.add(url)
  } catch {
    // A corrupt or unavailable store is an empty one.
  }
}

function save(): void {
  try {
    // Newest last, oldest dropped: the tail is what a reader is scrolling through now.
    window.localStorage.setItem(KEY, JSON.stringify([...known].slice(-MAX)))
  } catch {
    // Private-mode Safari and a full quota both throw.
  }
}

/** Called by the player the instant a "video" turns out to have no picture. */
export function rememberAudioOnly(url: string): void {
  if (typeof window === 'undefined') return
  load()
  if (known.has(url)) return
  known.add(url)
  save()
  version += 1
  for (const listener of listeners) listener()
}

export function isAudioOnly(url: string): boolean {
  if (typeof window === 'undefined') return false
  load()
  return known.has(url)
}

/** Re-render the note when a verdict lands. */
export function useAudioOnlyVersion(): number {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
    () => 0,
  )
}
