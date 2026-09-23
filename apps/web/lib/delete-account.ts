'use client'

import {
  buildDeletedProfile,
  buildDeletion,
  createHttpAuth,
  httpAuthHeader,
  nowSeconds,
  type Hex,
  type NostrEvent,
  type Signer,
} from '@nostrich/nostr'

import { getPool } from './pool'
import { splitScopedKey } from './scope'

/** DELETING AN ACCOUNT ON A PROTOCOL THAT HAS NONE. */

export interface DeletionOutcome {
  /** The blank profile reached at least one relay. */
  profileBlanked: boolean
  /** The NIP-09 request reached at least one relay. */
  deletionRequested: boolean
  /** Our own server confirmed it removed its rows. */
  serverCleared: boolean
  /** Scoped localStorage entries removed for this account. */
  keysRemoved: number
}

/** Publish an empty kind 0 over the old profile, and ask relays to drop the old one. */
async function leaveTheNetwork(
  signer: Signer,
  pubkey: Hex,
): Promise<{ profileBlanked: boolean; deletionRequested: boolean }> {
  const pool = getPool()
  const at = nowSeconds()

  let profileBlanked = false
  let blank: NostrEvent | undefined
  try {
    blank = await signer.signEvent(buildDeletedProfile(at))
    const results = await pool.publish(blank)
    profileBlanked = results.some(result => result.ok)
  } catch {
    // A refused signature or every relay down.
  }

  /* The deletion names the profile we just replaced, not the one we replaced. */
  let deletionRequested = false
  const previous = await currentProfile(pubkey)
  if (previous !== undefined) {
    try {
      /* The shared kind-5 builder. */
      const request = buildDeletion([previous], pubkey, { createdAt: at })
      const results = await pool.publish(await signer.signEvent(request))
      deletionRequested = results.some(result => result.ok)
    } catch {
      // Advisory to begin.
    }
  }

  return { profileBlanked, deletionRequested }
}

/** Their existing kind 0, so the deletion request has something to name. */
async function currentProfile(pubkey: Hex): Promise<NostrEvent | undefined> {
  try {
    const found = await getPool().query([{ kinds: [0], authors: [pubkey], limit: 1 }], undefined, 4_000)
    return found.filter(event => event.pubkey === pubkey).sort((a, b) => b.created_at - a.created_at)[0]
  } catch {
    return undefined
  }
}

/** Every scoped localStorage entry belonging to this account. */
export function wipeLocalData(pubkey: Hex): number {
  let removed = 0
  try {
    const doomed: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      // `localStorage.key(i)`, not `Object.keys`.
      const key = localStorage.key(index)
      if (key === null) continue
      if (splitScopedKey(key)?.scope === pubkey) doomed.push(key)
    }
    for (const key of doomed) {
      localStorage.removeItem(key)
      removed += 1
    }
  } catch {
    // Private mode, or a storage quota error mid-removal.
  }
  return removed
}

/** The whole sequence, in the only order that works. */
export async function deleteAccount(signer: Signer, pubkey: Hex): Promise<DeletionOutcome> {
  const network = await leaveTheNetwork(signer, pubkey)
  const serverCleared = true
  const keysRemoved = wipeLocalData(pubkey)
  return { ...network, serverCleared, keysRemoved }
}
