'use client'

import { useCallback, useMemo } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  dmRelayListFilter,
  parseDmRelayList,
  tryNormalizeRelayUrl,
  type Hex,
  type RelayUrl,
  type Signer,
} from '@nostrich/nostr'

import { publishDmRelayList } from './chat'
import { getPool } from './pool'
import { fetchRelayInfo, refusesStrangers, type RelayInfo } from './relay-info'

/** The reader's own DM inbox list (kind-10050), and whether the relays on it can do. */

/** Longer than an ordinary read: a wrong answer here would be edited and published. */
const TIMEOUT_MS = 8_000

export interface DmRelayList {
  /** What is published today. Empty array means a list exists but names nothing. */
  relays: RelayUrl[]
  /** No kind-10050 found. */
  missing: boolean
  updatedAt?: number
}

export function dmRelayListQueryKey(pubkey: Hex | undefined): readonly unknown[] {
  return ['dm-relay-list', pubkey ?? '']
}

export function useOwnDmRelays(pubkey: Hex | undefined): {
  list: DmRelayList | undefined
  loading: boolean
  /** Nobody answered. The list is unknown, which is NOT the same as absent. */
  unanswered: boolean
} {
  const query = useQuery({
    queryKey: dmRelayListQueryKey(pubkey),
    queryFn: async (): Promise<DmRelayList & { answered: boolean }> => {
      const outcome = await getPool().queryWithStatus(
        [dmRelayListFilter([pubkey as Hex])],
        undefined,
        TIMEOUT_MS,
      )
      let newest: { relays: RelayUrl[]; updatedAt: number } | null = null
      for (const event of outcome.events) {
        const parsed = parseDmRelayList(event)
        if (parsed === null) continue
        if (newest === null || parsed.updatedAt > newest.updatedAt) {
          newest = { relays: parsed.relays, updatedAt: parsed.updatedAt }
        }
      }
      if (newest === null) {
        return { relays: [], missing: true, answered: outcome.answered > 0 }
      }
      return {
        relays: newest.relays,
        missing: false,
        updatedAt: newest.updatedAt,
        answered: true,
      }
    },
    enabled: pubkey !== undefined,
    // Short: the reader may have just published from here, or from another client.
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })

  return {
    list: query.data,
    loading: query.isPending && pubkey !== undefined,
    unanswered: query.data?.answered === false,
  }
}

export interface RelayConcern {
  relay: RelayUrl
  info: RelayInfo
}

/** The relays on a list that say they will not take a stranger's write. */
export function useDmRelayConcerns(relays: readonly RelayUrl[] | undefined): {
  concerns: RelayConcern[]
  loading: boolean
} {
  const list = useMemo(() => relays ?? [], [relays])
  const results = useQueries({
    queries: list.map(relay => ({
      queryKey: ['relay-info', relay],
      queryFn: () => fetchRelayInfo(relay).then(info => info ?? null),
      // A relay's admission policy changes on the order of never.
      staleTime: 60 * 60_000,
      gcTime: 2 * 60 * 60_000,
    })),
  })

  const concerns = useMemo(() => {
    const out: RelayConcern[] = []
    results.forEach((result, at) => {
      const info = result.data
      const relay = list[at]
      // `null` is "we could not find out", and an unknown is never shown as a fault.
      if (info === null || info === undefined || relay === undefined) return
      if (refusesStrangers(info)) out.push({ relay, info })
    })
    return out
    // `results` is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, results.map(r => (r.data === undefined ? '?' : JSON.stringify(r.data))).join('|')])

  return { concerns, loading: results.some(result => result.isPending) }
}

export function useSaveDmRelays(
  signer: Signer | undefined,
  pubkey: Hex | undefined,
): (relays: readonly RelayUrl[]) => Promise<boolean> {
  const client = useQueryClient()
  return useCallback(
    async (relays: readonly RelayUrl[]) => {
      if (signer === undefined || pubkey === undefined) return false
      const normalised: RelayUrl[] = []
      for (const raw of relays) {
        const url = tryNormalizeRelayUrl(raw)
        if (url !== undefined && !normalised.includes(url)) normalised.push(url)
      }
      // `buildDmRelayList` refuses an empty list, and rightly: an empty kind-10050 reads.
      if (normalised.length === 0) return false
      const ok = await publishDmRelayList(signer, pubkey, normalised)
      if (ok) await client.invalidateQueries({ queryKey: dmRelayListQueryKey(pubkey) })
      return ok
    },
    [signer, pubkey, client],
  )
}
