'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type Hex, type NostrEvent, type Signer } from '@nostrich/nostr'

import { getPool } from './pool'

/** The note an account has pinned to the top of its profile. */

const PINNED_KIND = 10001
const TIMEOUT_MS = 6_000

/** The pinned note id for one account, or undefined when nothing is pinned. */
export function usePinnedId(pubkey: Hex | undefined): string | undefined {
  const query = useQuery({
    queryKey: ['pinned', pubkey ?? ''],
    queryFn: async (): Promise<string | null> => {
      if (pubkey === undefined) return null
      const events = await getPool().query(
        [{ kinds: [PINNED_KIND], authors: [pubkey], limit: 4 }],
        undefined,
        TIMEOUT_MS,
      )
      // Replaceable: newest wins.
      let newest: NostrEvent | undefined
      for (const event of events) {
        if (event.pubkey !== pubkey) continue
        if (newest === undefined || event.created_at > newest.created_at) newest = event
      }
      if (newest === undefined) return null
      // The LAST e-tag, so a list written by another client that keeps several still.
      const ids = newest.tags.filter(tag => tag[0] === 'e' && typeof tag[1] === 'string')
      return ids[ids.length - 1]?.[1] ?? null
    },
    enabled: pubkey !== undefined,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
  return query.data ?? undefined
}

export interface PinApi {
  /** Publish a new kind-10001 naming this note, replacing whatever was pinned. */
  pin: (noteId: string) => Promise<boolean>
  unpin: () => Promise<boolean>
}

export function usePinning(signer: Signer | undefined, pubkey: Hex | undefined): PinApi {
  const queryClient = useQueryClient()

  const publish = useCallback(
    async (ids: string[]): Promise<boolean> => {
      if (signer === undefined || pubkey === undefined) return false
      const template = {
        kind: PINNED_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: ids.map(id => ['e', id]),
        // NIP-51 reserves `content` on a public list for an encrypted private section.
        content: '',
      }
      const signed = await signer.signEvent(template)
      const results = await getPool().publish(signed)
      const accepted = results.some(result => result.ok)
      if (accepted) {
        /** Written straight into the cache rather than waiting for a refetch. */
        queryClient.setQueryData(['pinned', pubkey], ids[ids.length - 1] ?? null)
      }
      return accepted
    },
    [signer, pubkey, queryClient],
  )

  return {
    pin: useCallback((noteId: string) => publish([noteId]), [publish]),
    unpin: useCallback(() => publish([]), [publish]),
  }
}
