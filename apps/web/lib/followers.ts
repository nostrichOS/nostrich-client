'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KINDS, type Hex } from '@nostrich/nostr'

import { getPool } from './pool'
import { readCachedStats, writeCachedStats } from './profile-cache'

/** How many accounts follow this pubkey. */

/** Relays cap what they return. */
const CAP = 1_000

export interface FollowerCount {
  count: number
  /** True when the number is a relay-derived floor rather than a total. */
  capped: boolean
  loading: boolean
}

/** Writes through to the persisted store and returns the value. */
function remember(pubkey: Hex, value: { count: number; capped: boolean }) {
  writeCachedStats(pubkey, { followers: value.count, capped: value.capped })
  return value
}

/** Four seconds, not eight. */
const COUNT_TIMEOUT_MS = 4_000

export function useFollowerCount(pubkey: Hex | undefined): FollowerCount {
  /** Last time's answer, painted while this time's is fetched. */
  const cached = useMemo(() => readCachedStats(pubkey), [pubkey])

  const query = useQuery({
    queryKey: ['followers', pubkey ?? ''],
    queryFn: async (): Promise<{ count: number; capped: boolean }> => {
      if (pubkey === undefined) return { count: 0, capped: false }

      /** NIP-45 COUNT, where a relay implements it, is the whole answer. */
      const counted = await getPool()
        .count([{ kinds: [KINDS.contacts], '#p': [pubkey] }], undefined, COUNT_TIMEOUT_MS)
        .catch(() => undefined)
      if (counted !== undefined) return remember(pubkey, { count: counted, capped: false })

      // No relay in the set implements COUNT, so the lists get counted by hand.
      const events = await getPool().query(
        [{ kinds: [KINDS.contacts], '#p': [pubkey], limit: CAP }],
        undefined,
        8_000,
      )
      // One follower may have their kind-3 on six relays.
      const authors = new Set(events.map(event => event.pubkey))
      return remember(pubkey, { count: authors.size, capped: events.length >= CAP })
    },
    enabled: pubkey !== undefined,
    // Expensive and slow-moving.
    staleTime: 60 * 60 * 1000,
    ...(cached?.followers === undefined
      ? {}
      : {
          initialData: { count: cached.followers, capped: cached.capped ?? false },
          initialDataUpdatedAt: cached.at,
        }),
  })

  return {
    count: query.data?.count ?? 0,
    capped: query.data?.capped ?? false,
    loading: query.isLoading,
  }
}
