'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { onScopedChange, readScoped, writeScoped } from './scope'
import { CHAT_ACCEPTED_KEY, CHAT_DELETED_KEY } from './settings-keys'

/** What the reader decided about a message request. */

const KEYS = {
  accepted: CHAT_ACCEPTED_KEY,
  deleted: CHAT_DELETED_KEY,
} as const

type Decision = keyof typeof KEYS

function parse(raw: string | null): Set<string> {
  if (raw === null) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set()
  }
}

function load(name: Decision): Set<string> {
  if (typeof window === 'undefined') return new Set()
  const scoped = parse(readScoped(KEYS[name]))
  if (scoped.size > 0) return scoped

  /* One-time move of the unscoped list into this account's scope. */
  const legacy = parse(localStorage.getItem(KEYS[name]))
  if (legacy.size === 0) return legacy
  localStorage.removeItem(KEYS[name])
  writeScoped(KEYS[name], JSON.stringify([...legacy]))
  return legacy
}

const decisions: Record<Decision, Set<string>> = {
  accepted: load('accepted'),
  deleted: load('deleted'),
}

const listeners = new Set<() => void>()
let version = 0

/** RE-READ WHEN THE ACCOUNT IN FRONT CHANGES. */
onScopedChange(base => {
  if (base !== undefined && base !== KEYS.accepted && base !== KEYS.deleted) return
  if (base === undefined || base === KEYS.accepted) decisions.accepted = load('accepted')
  if (base === undefined || base === KEYS.deleted) decisions.deleted = load('deleted')
  version += 1
  for (const listener of listeners) listener()
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function persist(name: Decision): void {
  try {
    writeScoped(KEYS[name], JSON.stringify([...decisions[name]]))
  } catch {
    // Private mode or quota.
  }
}

/** Synchronous, because the split runs outside React. */
export function isAccepted(conversationKey: string): boolean {
  return decisions.accepted.has(conversationKey)
}

export function isDeletedRequest(conversationKey: string): boolean {
  return decisions.deleted.has(conversationKey)
}

function set(name: Decision, conversationKey: string): void {
  // The two are mutually exclusive: accepting something previously deleted must.
  const other: Decision = name === 'accepted' ? 'deleted' : 'accepted'
  decisions[name] = new Set(decisions[name]).add(conversationKey)
  if (decisions[other].has(conversationKey)) {
    const next = new Set(decisions[other])
    next.delete(conversationKey)
    decisions[other] = next
    persist(other)
  }
  version += 1
  persist(name)
  for (const listener of listeners) listener()
}

export function acceptRequest(conversationKey: string): void {
  set('accepted', conversationKey)
}

export function deleteRequest(conversationKey: string): void {
  set('deleted', conversationKey)
}

/** Undo, for a reader who deleted the wrong thing. */
export function restoreRequest(conversationKey: string): void {
  for (const name of ['accepted', 'deleted'] as Decision[]) {
    if (!decisions[name].has(conversationKey)) continue
    const next = new Set(decisions[name])
    next.delete(conversationKey)
    decisions[name] = next
    persist(name)
  }
  version += 1
  for (const listener of listeners) listener()
}

function snapshot(): number {
  return version
}

function serverSnapshot(): number {
  return 0
}

export function useChatRequestsVersion(): number {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}

/** Re-renders on a decision, and hands back the two predicates. */
export function useChatRequests(): {
  accepted: (conversationKey: string) => boolean
  deleted: (conversationKey: string) => boolean
  accept: (conversationKey: string) => void
  remove: (conversationKey: string) => void
} {
  const revision = useChatRequestsVersion()
  return {
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the signal
    accepted: useCallback((key: string) => isAccepted(key), [revision]),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the signal
    deleted: useCallback((key: string) => isDeletedRequest(key), [revision]),
    accept: useCallback((key: string) => acceptRequest(key), []),
    remove: useCallback((key: string) => deleteRequest(key), []),
  }
}
