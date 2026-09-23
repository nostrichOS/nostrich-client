'use client'

import { useSyncExternalStore } from 'react'
import { onScopedChange, readScoped, writeScoped } from './scope'
import { BOOKMARKS_PUBLIC_KEY as KEY } from './settings-keys'

/** Whether new bookmarks are published in the clear. */

/** Public. */
const DEFAULT_PUBLIC = true

let current: boolean | undefined
const listeners = new Set<() => void>()

function read(): boolean {
  if (current !== undefined) return current
  try {
    const raw = readScoped(KEY)
    current = raw === null ? DEFAULT_PUBLIC : raw === 'true'
  } catch {
    // Private browsing.
    current = DEFAULT_PUBLIC
  }
  return current
}

function snapshot(): boolean {
  return read()
}

/** The server cannot know, and must not guess differently from the client. */
function serverSnapshot(): boolean {
  return DEFAULT_PUBLIC
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setBookmarksPublic(value: boolean): void {
  current = value
  writeScoped(KEY, String(value))
  for (const listener of listeners) listener()
}

/** Whether a reader's bookmarks are public is theirs to decide PER IDENTITY. */
onScopedChange(base => {
  if (base !== undefined && base !== KEY) return
  current = undefined
  for (const listener of listeners) listener()
})

export function useBookmarksPublic(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}

/** The same answer outside React, for the publish path. */
export function bookmarksArePublic(): boolean {
  return read()
}
