'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KINDS, type Bookmark, type Hex, type NostrEvent } from '@nostrich/nostr'

import { getPool } from './pool'
import { sessionPubkey, useSession } from '../components/SessionProvider'

/** Notes the reader has liked, newest first. */

const LIMIT = 300
const TIMEOUT_MS = 8_000

/** NIP-25: `-` is a dislike. */
function isLike(event: NostrEvent): boolean {
  return event.content.trim() !== '-'
}

/** Which note a reaction points. */
function targetOf(event: NostrEvent): Hex | undefined {
  let found: Hex | undefined
  for (const tag of event.tags) {
    if (tag[0] === 'e' && tag[1] !== undefined && tag[1].length === 64) found = tag[1]
  }
  return found
}

export interface LikesResult {
  /** Reused as bookmark pointers so the same resolver fetches the notes. */
  items: Bookmark[]
  loading: boolean
}

/** Ids of notes this reader has already liked. */
export function useLikeIndex(): LikeIndex {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const key = pubkey ?? ''
  const query = useQuery({ ...likesQuery(key), enabled: key !== '' })
  return useMemo(() => new Map(query.data ?? []), [query.data])
}

/** Note id -> the id of MY reaction. */
export type LikeIndex = ReadonlyMap<Hex, Hex>

/** Shared so the two hooks below cannot drift into two different requests. */
function likesQuery(key: string) {
  return {
    queryKey: ['likes', key] as const,
    queryFn: async (): Promise<[Hex, Hex][]> => {
      if (key === '') return []
      const events = await getPool().query(
        [{ kinds: [KINDS.reaction], authors: [key], limit: LIMIT }],
        undefined,
        TIMEOUT_MS,
      )
      const seen = new Set<Hex>()
      return events
        .filter(isLike)
        // By when the LIKE happened, not when the note was written: this is a record.
        .sort((a, b) => b.created_at - a.created_at)
        .flatMap((event): [Hex, Hex][] => {
          const target = targetOf(event)
          // A note liked twice from two clients is one entry, at the newer.
          if (target === undefined || seen.has(target)) return []
          seen.add(target)
          return [[target, event.id]]
        })
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  }
}

export function useLikes(): LikesResult {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const key = pubkey ?? ''
  const query = useQuery({ ...likesQuery(key), enabled: key !== '' })

  const items = useMemo(
    (): Bookmark[] => (query.data ?? []).map(([id]) => ({ type: 'e', value: id })),
    [query.data],
  )

  return { items, loading: query.isPending && key !== '' }
}

/** Drop a note from the cached like list. */
/** Record a like that was just published. */
export function useRememberLike(): (noteId: Hex, reactionId: Hex) => void {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const client = useQueryClient()

  return useCallback(
    (noteId: Hex, reactionId: Hex) => {
      const key = ['likes', pubkey ?? ''] as const
      client.setQueryData<[Hex, Hex][]>(key, current => {
        const rest = (current ?? []).filter(([target]) => target !== noteId)
        // Newest first: the list is ordered by when the LIKE happened, and this one just did.
        return [[noteId, reactionId], ...rest]
      })
    },
    [client, pubkey],
  )
}

export function useForgetLike(): (noteId: Hex) => void {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const client = useQueryClient()

  return useCallback(
    (noteId: Hex) => {
      const key = ['likes', pubkey ?? ''] as const
      client.setQueryData<[Hex, Hex][]>(key, current =>
        (current ?? []).filter(([target]) => target !== noteId),
      )
    },
    [client, pubkey],
  )
}
