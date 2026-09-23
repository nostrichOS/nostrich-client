'use client'

import { useQuery } from '@tanstack/react-query'
import type { Hex } from '@nostrich/nostr'

import { getPool } from './pool'

/** The Blossom servers an author says their media lives. */
export function useBlossomServers(pubkey: Hex | undefined, enabled = true): string[] {
  return useBlossomServerList(pubkey, enabled).servers
}

/** The same list, plus whether the relays have actually answered yet. */
/** The lookup itself, so the hook and the UPLOADER share one definition and one cache. */
export function blossomServersQuery(pubkey: Hex | undefined) {
  return {
    queryKey: ['blossom-servers', pubkey ?? ''] as const,
    queryFn: async (): Promise<string[]> => {
      if (pubkey === undefined) return []
      const events = await getPool().query(
        [{ kinds: [10063], authors: [pubkey], limit: 1 }] as never,
        undefined,
        6_000,
      )
      // Replaceable: relays should hand back one, but take the newest if several arrive.
      const newest = events.reduce<(typeof events)[number] | undefined>(
        (best, event) => (best === undefined || event.created_at > best.created_at ? event : best),
        undefined,
      )
      if (newest === undefined) return []
      return newest.tags
        .filter(tag => tag[0] === 'server' && typeof tag[1] === 'string')
        .map(tag => (tag[1] as string).replace(/\/+$/, ''))
        .filter(url => /^https:\/\//i.test(url))
        .slice(0, 8)
    },
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
  }
}

export function useBlossomServerList(
  pubkey: Hex | undefined,
  enabled = true,
): { servers: string[]; settled: boolean } {
  const query = useQuery({
    ...blossomServersQuery(pubkey),
    enabled: enabled && pubkey !== undefined,
  })
  const active = enabled && pubkey !== undefined
  return { servers: query.data ?? EMPTY, settled: !active || query.isFetched }
}

const EMPTY: string[] = []
