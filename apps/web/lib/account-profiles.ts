'use client'

import type { Hex, Profile } from '@nostrich/nostr'

/** The reader's OWN accounts, remembered properly. */

const KEY = 'nostrich:account-profiles:v1'

interface Stored {
  n?: string
  d?: string
  p?: string
  v?: string
  /** Written at, epoch ms. Only used to prefer the newer of two copies. */
  t: number
}

function read(): Record<string, Stored> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, Stored>) : {}
  } catch {
    return {}
  }
}

let store = read()

/** The stored profile for one of the reader's accounts, or undefined. */
export function readAccountProfile(pubkey: Hex | undefined): Profile | undefined {
  if (pubkey === undefined) return undefined
  const entry = store[pubkey]
  if (entry === undefined) return undefined
  return {
    pubkey,
    // Zero, like `readCachedProfile`: it says "older than anything the network will.
    updatedAt: 0,
    ...(entry.n === undefined ? {} : { name: entry.n }),
    ...(entry.d === undefined ? {} : { displayName: entry.d }),
    ...(entry.p === undefined ? {} : { picture: entry.p }),
    ...(entry.v === undefined ? {} : { nip05: entry.v }),
  }
}

/** Remember one of the reader's own profiles. */
export function writeAccountProfile(pubkey: Hex, profile: Profile | null): void {
  if (profile === null) return
  const entry: Stored = { t: Date.now() }
  if (profile.name !== undefined && profile.name !== '') entry.n = profile.name
  if (profile.displayName !== undefined && profile.displayName !== '') entry.d = profile.displayName
  if (profile.picture !== undefined && profile.picture !== '') entry.p = profile.picture
  if (profile.nip05 !== undefined && profile.nip05 !== '') entry.v = profile.nip05
  if (entry.n === undefined && entry.d === undefined && entry.p === undefined) return

  store = { ...store, [pubkey]: entry }
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Private mode or a full quota.
  }
}

/** Accounts no longer signed in, dropped on sign-out so the store cannot grow unbounded. */
export function forgetAccountProfiles(keep: readonly Hex[]): void {
  const kept: Record<string, Stored> = {}
  for (const pubkey of keep) {
    const entry = store[pubkey]
    if (entry !== undefined) kept[pubkey] = entry
  }
  store = kept
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // As above.
  }
}
