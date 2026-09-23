'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KINDS, type Hex } from '@nostrich/nostr'

import { getPool } from './pool'
import { sessionPubkey, useSession } from '../components/SessionProvider'

/** Notes this reader has already reposted or zapped. */

/** Deliberately short. This answers "did I", not "show me everything I ever did". */
const LIMIT = 300
const TIMEOUT_MS = 8_000
const ZAP_RECEIPT = 9735

const STALE_MS = 5 * 60_000
const GC_MS = 30 * 60_000

/** Which note an event points. */
function targetOf(tags: readonly (readonly string[])[]): Hex | undefined {
  let found: Hex | undefined
  for (const tag of tags) {
    if (tag[0] === 'e' && tag[1] !== undefined && tag[1].length === 64) found = tag[1] as Hex
  }
  return found
}

function repostsQuery(key: string) {
  return {
    queryKey: ['my-reposts', key] as const,
    queryFn: async (): Promise<Hex[]> => {
      if (key === '') return []
      const events = await getPool().query(
        [{ kinds: [KINDS.repost], authors: [key], limit: LIMIT }],
        undefined,
        TIMEOUT_MS,
      )
      const out = new Set<Hex>()
      for (const event of events) {
        const target = targetOf(event.tags)
        if (target !== undefined) out.add(target)
      }
      return [...out]
    },
    staleTime: STALE_MS,
    gcTime: GC_MS,
  }
}

/** Zap receipts this reader PAID. */
function zapsQuery(key: string) {
  return {
    queryKey: ['my-zaps', key] as const,
    queryFn: async (): Promise<Hex[]> => {
      if (key === '') return []
      const events = await getPool().query(
        [{ kinds: [ZAP_RECEIPT], '#P': [key], limit: LIMIT }],
        undefined,
        TIMEOUT_MS,
      )
      const out = new Set<Hex>()
      for (const event of events) {
        // A zap to a PROFILE has no `e` tag.
        const target = targetOf(event.tags)
        if (target !== undefined) out.add(target)
      }
      return [...out]
    },
    staleTime: STALE_MS,
    gcTime: GC_MS,
  }
}

interface IndexQuery {
  queryKey: readonly [string, string]
  queryFn: () => Promise<Hex[]>
  staleTime: number
  gcTime: number
}

function useIndex(build: (key: string) => IndexQuery): ReadonlySet<Hex> {
  const { session } = useSession()
  const key = sessionPubkey(session) ?? ''
  const query = useQuery({ ...build(key), enabled: key !== '' })
  return useMemo(() => new Set(query.data ?? []), [query.data])
}

/** Ids of notes this reader has reposted. */
export function useMyReposts(): ReadonlySet<Hex> {
  return useIndex(repostsQuery)
}

/** Ids of notes this reader has zapped. */
export function useMyZaps(): ReadonlySet<Hex> {
  return useIndex(zapsQuery)
}

/** Record an action that just happened, without waiting for a relay to agree. */
function useRemember(name: 'my-reposts' | 'my-zaps'): (noteId: Hex) => void {
  const client = useQueryClient()
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  return useCallback(
    (noteId: Hex) => {
      if (pubkey === undefined) return
      client.setQueryData<Hex[]>([name, pubkey], current =>
        current === undefined
          ? [noteId]
          : current.includes(noteId)
            ? current
            : [noteId, ...current],
      )
    },
    [client, name, pubkey],
  )
}

export function useRememberRepost(): (noteId: Hex) => void {
  return useRemember('my-reposts')
}

export function useRememberZap(): (noteId: Hex) => void {
  return useRemember('my-zaps')
}
