'use client'

import { isPrivateUrl, type Hex, type RelayUrl } from '@nostrich/nostr'

/** Where a mention says its subject can be found. */

/** Two per person. A pointer that names five relays is not being more helpful. */
const MAX_PER_PUBKEY = 2
/** People remembered. */
const MAX_PEOPLE = 500

const hints = new Map<Hex, RelayUrl[]>()

export function rememberProfileHints(pubkey: Hex, relays: readonly RelayUrl[] | undefined): void {
  if (relays === undefined || relays.length === 0) return
  const held = hints.get(pubkey) ?? []
  let changed = false
  for (const relay of relays) {
    if (held.length >= MAX_PER_PUBKEY) break
    if (held.includes(relay)) continue
    // A note is untrusted input, and this ends in a websocket connection.
    if (isPrivateUrl(relay)) continue
    held.push(relay)
    changed = true
  }
  if (!changed) return
  // Re-inserted so it moves to the back of the eviction order on every sighting.
  hints.delete(pubkey)
  hints.set(pubkey, held)
  if (hints.size > MAX_PEOPLE) {
    const oldest = hints.keys().next().value
    if (oldest !== undefined) hints.delete(oldest)
  }
}

/** Where else to look for this person, or an empty list. */
export function profileHints(pubkey: Hex): readonly RelayUrl[] {
  return hints.get(pubkey) ?? []
}

/** Forgets everything. For tests. */
export function forgetProfileHints(): void {
  hints.clear()
}
