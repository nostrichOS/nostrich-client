'use client'

import type { Hex } from '@nostrich/nostr'

import { npubOf } from './format'

import { readCachedProfile, searchCachedProfiles } from './profile-cache'

/** A plain `@handle` in a bio, resolved to a key. */

/** `@name` where the name is the charset Nostr clients actually use for handles. */
const HANDLE = /@([a-z0-9_.-]{2,32})/gi

/** Cached profiles scanned per handle. */
const MAX_CANDIDATES = 40

/** `hal@finney.org` -> `hal`. A bare `_@domain` is the domain itself and names nobody. */
function localPart(nip05: string | undefined): string {
  if (nip05 === undefined) return ''
  const at = nip05.indexOf('@')
  const local = (at === -1 ? nip05 : nip05.slice(0, at)).toLowerCase()
  return local === '_' ? '' : local
}

/** The one account this handle can only mean, or undefined. */
export function resolveHandle(handle: string): Hex | undefined {
  const wanted = handle.trim().toLowerCase()
  if (wanted === '') return undefined

  const matches: Hex[] = []
  for (const cached of searchCachedProfiles(wanted, MAX_CANDIDATES)) {
    const profile = cached.profile
    const names = [profile.name, profile.displayName, localPart(profile.nip05)]
      .filter((value): value is string => typeof value === 'string' && value !== '')
      .map(value => value.toLowerCase())
    // EQUALS, not includes.
    if (!names.includes(wanted)) continue
    // `Profile` carries its own pubkey.
    const pubkey = profile.pubkey
    if (!matches.includes(pubkey)) matches.push(pubkey)
    if (matches.length > 1) return undefined
  }
  return matches[0]
}

/** Rewrite the handles that resolve into real `nostr:npub…` mentions, and leave. */
export function linkifyHandles(text: string): string {
  HANDLE.lastIndex = 0
  return text.replace(HANDLE, (whole, handle: string) => {
    const pubkey = resolveHandle(handle)
    if (pubkey === undefined) return whole
    // A cached entry that has since been forgotten is not a person to link.
    if (readCachedProfile(pubkey) === undefined) return whole
    return `nostr:${npubOf(pubkey)}`
  })
}
