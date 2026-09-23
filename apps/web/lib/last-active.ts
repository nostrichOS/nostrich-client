'use client'

import { useQuery } from '@tanstack/react-query'
import { DEFAULT_RELAYS, KINDS, type Hex } from '@nostrich/nostr'

import { getPool } from './pool'

/** When each of these accounts last published anything. */
const CHUNK = 20
const TIMEOUT_MS = 6_000

/** Notes, reposts and reactions. */
const ACTIVE_KINDS = [KINDS.shortNote, KINDS.repost, KINDS.reaction]

export async function fetchLastActive(pubkeys: readonly Hex[]): Promise<Map<Hex, number>> {
  const out = new Map<Hex, number>()
  if (pubkeys.length === 0) return out

  const chunks: Hex[][] = []
  for (let i = 0; i < pubkeys.length; i += CHUNK) chunks.push([...pubkeys.slice(i, i + CHUNK)])

  await Promise.all(
    chunks.map(async chunk => {
      try {
        const events = await getPool().query(
          chunk.map(author => ({ authors: [author], kinds: ACTIVE_KINDS, limit: 1 })),
          [...DEFAULT_RELAYS],
          TIMEOUT_MS,
        )
        for (const event of events) {
          const held = out.get(event.pubkey as Hex) ?? 0
          if (event.created_at > held) out.set(event.pubkey as Hex, event.created_at)
        }
      } catch {
        // A chunk that fails leaves its accounts undated, which sorts them last.
      }
    }),
  )

  return out
}

/** Lazily. */
export function useLastActive(
  pubkeys: readonly Hex[],
  enabled: boolean,
): ReadonlyMap<Hex, number> {
  // Sorted so the key does not change when the same people arrive in a different order.
  const key = [...pubkeys].sort().join(',')
  const query = useQuery({
    queryKey: ['last-active', key],
    queryFn: () => fetchLastActive(pubkeys),
    enabled: enabled && pubkeys.length > 0,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
  return query.data ?? EMPTY
}

const EMPTY: ReadonlyMap<Hex, number> = new Map()
