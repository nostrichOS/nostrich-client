'use client'

import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getTagValues, type Hex, type NostrEvent } from '@nostrich/nostr'

import { getPool } from './pool'

/** RESOLVING THE THING AN `naddr` POINTS. */

export interface AddressPointer {
  kind: number
  pubkey: Hex
  identifier: string
  /** The pointer as written. */
  bech32: string
  /** Relay hints from the naddr's own TLV. */
  relays?: readonly string[]
}

/** `kind:pubkey:identifier`. */
export function addressKey(segment: { kind: number; pubkey: string; identifier: string }): string {
  return `${segment.kind}:${segment.pubkey}:${segment.identifier}`
}

/** Addresses resolved per note. */
const MAX_ADDRESSES = 12

const TIMEOUT_MS = 6_000

/** Relay hints followed, on top of our own set. */
const MAX_HINT_RELAYS = 2

function addressEventQuery(segment: AddressPointer) {
  return {
    queryKey: ['address-event', addressKey(segment)] as const,
    queryFn: async (): Promise<NostrEvent | null> => {
      /* `#d` only when there IS one. */
      const filter: Record<string, unknown> = {
        kinds: [segment.kind],
        authors: [segment.pubkey],
        limit: 4,
        ...(segment.identifier === '' ? {} : { '#d': [segment.identifier] }),
      }
      const hints = (segment.relays ?? []).slice(0, MAX_HINT_RELAYS)
      const events = await getPool().query(
        [filter] as never,
        hints.length === 0 ? undefined : (hints as never),
        TIMEOUT_MS,
      )
      /* NEWEST WINS. */
      let newest: NostrEvent | undefined
      for (const event of events) {
        if (newest === undefined || event.created_at > newest.created_at) newest = event
      }
      return newest ?? null
    },
    /* Ten minutes. */
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  }
}

/** The addressable event behind one pointer, for the card that draws. */
export function useAddressEvent(segment: AddressPointer | undefined): {
  event: NostrEvent | undefined
  loading: boolean
} {
  const query = useQuery({
    // A complete placeholder for the disabled case.
    ...addressEventQuery(segment ?? { kind: 0, pubkey: '' as Hex, identifier: '', bech32: '' }),
    enabled: segment !== undefined,
  })
  return {
    event: query.data ?? undefined,
    // `isPending` with `enabled: false` is true forever, which would leave a skeleton.
    loading: segment !== undefined && query.isPending,
  }
}

/** The `title` tag, which NIP-53 streams and NIP-23 articles both carry. */
function titleOf(event: NostrEvent): string | undefined {
  const title = getTagValues(event, 'title')[0]?.trim()
  if (title !== undefined && title !== '') return title
  const summary = getTagValues(event, 'summary')[0]?.trim()
  return summary === undefined || summary === '' ? undefined : summary.slice(0, 80)
}

/** Titles for the addressable events a note points at, for the ones rendered INLINE. */
export function useAddressTitles(
  segments: readonly AddressPointer[],
): (segment: { kind: number; pubkey: string; identifier: string }) => string | undefined {
  const wanted = useMemo(() => {
    const seen = new Set<string>()
    const out: AddressPointer[] = []
    for (const segment of segments) {
      const key = addressKey(segment)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(segment)
      if (out.length >= MAX_ADDRESSES) break
    }
    return out
    // Keyed on the ADDRESSES rather than the array identity: the caller rebuilds.
  }, [segments.map(addressKey).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const results = useQueries({ queries: wanted.map(segment => addressEventQuery(segment)) })

  return useMemo(() => {
    const titles = new Map<string, string>()
    for (const [index, result] of results.entries()) {
      const segment = wanted[index]
      const event = result.data
      if (segment === undefined || event === null || event === undefined) continue
      const title = titleOf(event)
      if (title !== undefined) titles.set(addressKey(segment), title)
    }
    return (segment: { kind: number; pubkey: string; identifier: string }): string | undefined =>
      titles.get(addressKey(segment))
  }, [results, wanted])
}
