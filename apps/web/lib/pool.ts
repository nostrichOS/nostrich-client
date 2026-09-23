import { createPool, type Hex, type Pool } from '@nostrich/nostr'

import { readCachedNip05, readCachedProfile } from './profile-cache'
import { rejectEvent } from './spam'

let pool: Pool | undefined

/** The one relay pool for the tab. */
export function getPool(): Pool {
  if (typeof window === 'undefined') {
    throw new Error('getPool() is browser-only; call it from an effect or an event handler')
  }
  if (pool === undefined) {
    /** `reject` is the one filter that lives this low. */
    pool = createPool({
      reject: event => rejectEvent(event, hasVerifiedNip05, cachedNames),
    })
  }
  return pool
}

/** Whether this author's NIP-05 is known-good, answered from cache alone. */
/** The author's name fields, from cache alone, for `spam.ts`'s name rule. */
function cachedNames(pubkey: Hex): { name?: string; displayName?: string; nip05?: string } | undefined {
  return readCachedProfile(pubkey)?.profile
}

function hasVerifiedNip05(pubkey: Hex): boolean {
  const cached = readCachedProfile(pubkey)
  const claim = cached?.profile.nip05?.trim() ?? ''
  if (claim === '') return false
  return readCachedNip05(pubkey, claim)?.ok === true
}
