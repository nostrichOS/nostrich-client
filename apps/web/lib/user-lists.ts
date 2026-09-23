'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Hex } from '@nostrich/nostr'
import {
  accountsHere,
  activeScope,
  ANON_SCOPE,
  inheritScoped,
  onScopedChange,
  readScoped,
  writeScoped,
} from './scope'

/** Per-reader lists. */

const KEYS = {
  muted: 'nostrich:muted',
  /** Accounts whose REPOSTS are hidden, while their own notes still show. */
  mutedReposts: 'nostrich:muted-reposts',
  /** Accounts the reader DELIBERATELY un-muted, kept so the un-mute cannot be undone. */
  unmuted: 'nostrich:unmuted',
} as const

/** The two lists that hold TEXT rather than keys. */
const TERM_KEYS = {
  mutedHashtags: 'nostrich:muted-hashtags',
  mutedWords: 'nostrich:muted-words',
} as const

export type ListName = keyof typeof KEYS
export type TermListName = keyof typeof TERM_KEYS

function load(name: ListName | TermListName): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = readScoped(ALL_KEYS[name])
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    // Corrupt storage must not take a profile page down.
    return new Set()
  }
}

const ALL_KEYS = { ...KEYS, ...TERM_KEYS }

const lists: Record<ListName | TermListName, Set<string>> = {
  muted: load('muted'),
  mutedReposts: load('mutedReposts'),
  unmuted: load('unmuted'),
  mutedHashtags: load('mutedHashtags'),
  mutedWords: load('mutedWords'),
}

const listeners = new Set<() => void>()
/** Bumped on every change. */
let version = 0

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function persist(name: ListName | TermListName): void {
  // Losing a mute is bad.
  writeScoped(ALL_KEYS[name], JSON.stringify([...lists[name]]))
}

/** A mute belongs to the identity that made. */
onScopedChange(base => {
  const names = Object.keys(ALL_KEYS) as (ListName | TermListName)[]
  if (base !== undefined && !names.some(name => ALL_KEYS[name] === base)) return
  if (activeScope() !== ANON_SCOPE && accountsHere() <= 1) {
    for (const name of names) inheritScoped(ALL_KEYS[name], ANON_SCOPE)
  }
  for (const name of names) lists[name] = load(name)
  version += 1
  for (const listener of listeners) listener()
})

/** YOU CANNOT MUTE YOURSELF, whatever any stored list says. */
function isSelf(pubkey: Hex): boolean {
  return activeScope() !== ANON_SCOPE && pubkey === activeScope()
}

/** Synchronous membership, for the code paths that are not React. */
export function isMuted(pubkey: Hex): boolean {
  if (isSelf(pubkey)) return false
  return lists.muted.has(pubkey)
}

/** Whether this account's REPOSTS are hidden. */
export function isRepostMuted(pubkey: Hex): boolean {
  if (isSelf(pubkey)) return false
  return lists.mutedReposts.has(pubkey)
}

export function inList(name: ListName, pubkey: Hex): boolean {
  if (isSelf(pubkey)) return false
  return lists[name].has(pubkey)
}

/** The list as it should be seen. */
export function listMembers(name: ListName): Hex[] {
  return [...lists[name]].filter(pubkey => !isSelf(pubkey as Hex)) as Hex[]
}

/** Add or remove, and tell everyone. */
export function toggleList(name: ListName, pubkey: Hex): boolean {
  return toggleEntry(name, pubkey)
}

/** Idempotent, for callers that mean "make sure this is muted". */
export function addToList(name: ListName, pubkey: Hex): void {
  if (lists[name].has(pubkey)) return
  toggleList(name, pubkey)
}

function toggleEntry(name: ListName | TermListName, value: string): boolean {
  /* Never store yourself. */
  if ((name === 'muted' || name === 'mutedReposts') && isSelf(value as Hex)) return false
  const next = new Set(lists[name])
  const nowMember = !next.has(value)
  if (nowMember) next.add(value)
  else next.delete(value)
  lists[name] = next
  version += 1
  persist(name)

  /* Un-muting an ACCOUNT leaves a tombstone. */
  if (name === 'muted') {
    const graves = new Set(lists.unmuted)
    if (nowMember) graves.delete(value)
    else graves.add(value)
    lists.unmuted = graves
    persist('unmuted')
  }

  for (const listener of listeners) listener()
  return nowMember
}

// --------------------------------------------------------------------------- Muted.

/** ONE CANONICAL FORM, applied on the way in and on the way out. */
export function normalizeTerm(value: string): string {
  return value.trim().replace(/^#+/, '').toLowerCase()
}

export function termMembers(name: TermListName): string[] {
  return [...lists[name]]
}

/** Add one. */
export function addTerm(name: TermListName, value: string): boolean {
  const term = normalizeTerm(value)
  if (term === '' || lists[name].has(term)) return false
  return toggleEntry(name, term)
}

/** Replace a whole term list, for `mute-sync` reconciling against a newer published one. */
export function setTerms(name: TermListName, values: readonly string[]): void {
  const next = new Set(values.map(normalizeTerm).filter(term => term !== ''))
  const held = lists[name]
  if (next.size === held.size && [...next].every(term => held.has(term))) return
  lists[name] = next
  version += 1
  persist(name)
  for (const listener of listeners) listener()
}

export function removeTerm(name: TermListName, value: string): void {
  const term = normalizeTerm(value)
  if (!lists[name].has(term)) return
  toggleEntry(name, term)
}

function snapshot(): number {
  return version
}

function serverSnapshot(): number {
  return 0
}

/** Re-renders callers when a list changes. */
export function useUserListsVersion(): number {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}

/** The React view, kept so existing call sites do not change shape. */
export function useUserList(name: ListName): {
  members: Hex[]
  has: (pubkey: Hex) => boolean
  toggle: (pubkey: Hex) => void
} {
  const revision = useUserListsVersion()

  // Keyed on the version, so the array identity is stable until something actually.
  const members = useMemo(() => [...lists[name]], [name, revision])
  // `revision` is a real dependency: it is what makes this callback change identity.
  const has = useCallback((pubkey: Hex) => inList(name, pubkey), [name, revision])
  const toggle = useCallback((pubkey: Hex) => void toggleList(name, pubkey), [name])

  return { members, has, toggle }
}
