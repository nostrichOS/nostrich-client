'use client'

import type { Hex } from '@nostrich/nostr'

/** When this device first looked at an account, per account. */

/** The key predates this file's name. */
const KEY = 'nostrich:alerts-seed:'

const cache = new Map<string, number>()

export function firstLookAt(pubkey: Hex | undefined): number {
  if (pubkey === undefined) return 0
  const held = cache.get(pubkey)
  if (held !== undefined) return held

  const now = Math.floor(Date.now() / 1000)
  let at = now
  try {
    const raw = Number(localStorage.getItem(KEY + pubkey))
    if (Number.isFinite(raw) && raw > 0) at = raw
    else localStorage.setItem(KEY + pubkey, String(now))
  } catch {
    // Private mode.
  }
  cache.set(pubkey, at)
  return at
}

/** Forgets the in-memory copy. For tests, which clear storage between cases. */
export function forgetFirstLook(): void {
  cache.clear()
}
