'use client'

import { useQuery } from '@tanstack/react-query'
import { KINDS, type Hex, type NostrEvent } from '@nostrich/nostr'

import { manipulatedEngagement, type ObservedCounts } from './abuse'
import { readCachedProfile } from './profile-cache'
import { hasUsableName } from './quality'
import { getPool } from './pool'
import { prefetchProfiles } from './profiles'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

/** Which trending candidates were pushed there by accounts with no history. */

/** Replies fetched per sweep. Generous: this is one query covering every candidate. */
const REPLY_LIMIT = 500
const TIMEOUT_MS = 6_000

/** The verdict, and whether it has been reached yet. */
export interface ReplyFarms {
  farmed: ReadonlySet<string>
  /** False only while the first sweep for this id set is still in flight. */
  settled: boolean
}

export function useReplyFarms(
  ids: readonly Hex[],
  counts: ReadonlyMap<string, ObservedCounts>,
  enabled: boolean,
): ReplyFarms {
  const client = useQueryClient()
  const key = [...ids].sort().join(',')

  const query = useQuery({
    queryKey: ['reply-farms', key],
    queryFn: async (): Promise<NostrEvent[]> => {
      if (key === '') return []
      // One filter, every candidate.
      return getPool().query(
        [{ kinds: [KINDS.shortNote, KINDS.comment], '#e': key.split(','), limit: REPLY_LIMIT }] as never,
        undefined,
        TIMEOUT_MS,
      )
    },
    enabled: enabled && key !== '',
    // Trending moves slowly and this is a judgement about accounts, not about the minute.
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  })

  /** Repliers per candidate, from the one sweep above. */
  const byNote = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const reply of query.data ?? []) {
      for (const tag of reply.tags) {
        if (tag[0] !== 'e' || typeof tag[1] !== 'string') continue
        const held = out.get(tag[1])
        if (held === undefined) out.set(tag[1], [reply.pubkey])
        else if (!held.includes(reply.pubkey)) held.push(reply.pubkey)
      }
    }
    return out
  }, [query.data])

  /* Names for the repliers, so "no profile" means we looked rather than that we did. */
  const authorKey = useMemo(
    () => [...new Set([...byNote.values()].flat())].slice(0, 200).join(','),
    [byNote],
  )
  useEffect(() => {
    if (authorKey === '') return
    void prefetchProfiles(client, authorKey.split(',') as Hex[])
  }, [authorKey, client])

  /* Nothing to wait for when the sweep is not running at all: a disabled hook. */
  const settled = !enabled || key === '' || !query.isPending

  const farmed = useMemo(() => {
    const farmed = new Set<string>()
    if (byNote.size === 0) return farmed
    const established = (pubkey: string): boolean =>
      hasUsableName(readCachedProfile(pubkey as Hex)?.profile ?? null)
    for (const [id, authors] of byNote) {
      const reason = manipulatedEngagement(counts.get(id), { authors, established })
      if (reason !== undefined) farmed.add(id)
    }
    return farmed
  }, [byNote, counts])

  return useMemo(() => ({ farmed, settled }), [farmed, settled])
}
