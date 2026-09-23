'use client'

import { useEffect, useState } from 'react'
import {
  RELAY_LIST_KIND,
  parseRelayList,
  type Hex,
  type NostrEvent,
  type RelayEntry,
  type RelayUrl,
} from '@nostrich/nostr'

import { getPool } from './pool'

/** Which relays are holding the reader's CURRENT relay list, and what that list. */

/** Long enough for a slow relay, short enough that the screen is not empty for a beat. */
const TIMEOUT_MS = 5_000

export interface RelayListHealth {
  /** The newest list seen anywhere, with its markers. */
  entries: RelayEntry[]
  /** `created_at` of that newest copy, or 0. */
  updatedAt: number
  /** Relays that answered with the newest copy. */
  current: number
  /** Relays that answered at all. */
  answered: number
  /** Relays asked. */
  asked: number
  /** False until the first sweep finishes, so the screen can say nothing rather than "0. */
  ready: boolean
}

const EMPTY: RelayListHealth = {
  entries: [],
  updatedAt: 0,
  current: 0,
  answered: 0,
  asked: 0,
  ready: false,
}

/** One relay's newest kind-10002 for this reader, or undefined if it has none or did. */
async function askOne(relay: RelayUrl, pubkey: Hex): Promise<NostrEvent | undefined> {
  try {
    const events = await getPool().query(
      [{ kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 1 }] as never,
      [relay],
      TIMEOUT_MS,
    )
    return events.reduce<NostrEvent | undefined>(
      (best, event) =>
        event.pubkey === pubkey && (best === undefined || event.created_at > best.created_at)
          ? event
          : best,
      undefined,
    )
  } catch {
    return undefined
  }
}

export function useRelayListHealth(
  pubkey: Hex | undefined,
  relays: readonly string[],
  enabled: boolean,
  /** Bump to sweep again. */
  nonce = 0,
): RelayListHealth {
  const [health, setHealth] = useState<RelayListHealth>(EMPTY)
  // The relay set as a string, so this re-runs when it CHANGES rather.
  const key = relays.join(',')

  useEffect(() => {
    if (!enabled || pubkey === undefined || key === '') {
      setHealth(EMPTY)
      return
    }
    let alive = true
    const targets = key.split(',') as RelayUrl[]

    void Promise.all(targets.map(relay => askOne(relay, pubkey))).then(found => {
      if (!alive) return
      const answers = found.filter((event): event is NostrEvent => event !== undefined)
      const newest = answers.reduce<NostrEvent | undefined>(
        (best, event) => (best === undefined || event.created_at > best.created_at ? event : best),
        undefined,
      )
      if (newest === undefined) {
        setHealth({ ...EMPTY, asked: targets.length, ready: true })
        return
      }
      let entries: RelayEntry[] = []
      try {
        entries = [...parseRelayList(newest).entries]
      } catch {
        // Unparseable is the same as unpublished for this screen's purposes.
      }
      setHealth({
        entries,
        updatedAt: newest.created_at,
        // Counted by TIMESTAMP, not by event id: two relays can hold byte-identical copies.
        current: answers.filter(event => event.created_at === newest.created_at).length,
        answered: answers.length,
        asked: targets.length,
        ready: true,
      })
    })

    return () => {
      alive = false
    }
  }, [pubkey, key, enabled, nonce])

  return health
}
