'use client'

import { useSyncExternalStore } from 'react'
import type { Hex } from '@nostrich/nostr'

/** Notes this reader has asked to delete. */

const KEY = 'nostrich:deleted:v1'

function load(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

let ids = load()
const listeners = new Set<() => void>()
/** Bumped on every change. */
let version = 0

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Synchronous, for code paths that are not React. */
export function isDeleted(id: Hex): boolean {
  return ids.has(id)
}

export function markDeleted(id: Hex): void {
  if (ids.has(id)) return
  ids = new Set(ids).add(id)
  version += 1
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]))
  } catch {
    // Private mode, or quota.
  }
  for (const listener of listeners) listener()
}

function snapshot(): number {
  return version
}

function serverSnapshot(): number {
  return 0
}

/** Re-renders callers when something is deleted. */
export function useDeletedVersion(): number {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
