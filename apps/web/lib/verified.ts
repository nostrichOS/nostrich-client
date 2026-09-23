'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Hex } from '@nostrich/nostr'

import { nip05Query } from './profiles'

/** Which of these accounts actually own their NIP-05 address. */
export function useVerifiedPubkeys(
  entries: readonly { pubkey: Hex; nip05?: string }[],
  enabled: boolean,
): { verified: ReadonlySet<Hex>; checking: boolean } {
  const client = useQueryClient()
  const [verified, setVerified] = useState<ReadonlySet<Hex>>(() => new Set())
  const [checking, setChecking] = useState(false)

  // The identity of the work, not of the array: a re-render with the same people must.
  const key = entries.map(entry => `${entry.pubkey}:${entry.nip05 ?? ''}`).join(',')

  useEffect(() => {
    if (!enabled || key === '') {
      setVerified(new Set())
      setChecking(false)
      return
    }
    let alive = true
    setChecking(true)
    void (async () => {
      const pairs = key.split(',').map(part => {
        const at = part.indexOf(':')
        return { pubkey: part.slice(0, at) as Hex, claim: part.slice(at + 1) }
      })
      const out = new Set<Hex>()
      await Promise.all(
        pairs.map(async ({ pubkey, claim }) => {
          // No claim is no verification.
          if (claim === '') return
          try {
            if (await client.fetchQuery(nip05Query(pubkey, claim))) out.add(pubkey)
          } catch {
            // A well-known document that will not load is not a verified one.
          }
        }),
      )
      if (!alive) return
      setVerified(out)
      setChecking(false)
    })()
    return () => {
      alive = false
    }
  }, [key, enabled, client])

  return { verified, checking }
}
