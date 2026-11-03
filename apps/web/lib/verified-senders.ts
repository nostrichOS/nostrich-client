'use client'

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { Hex } from '@nostrich/nostr'

import { readCachedNip05, readCachedProfile } from './profile-cache'
import { nip05Query, profileQuery } from './profiles'

/** At most this many senders are checked; the rest are treated as unverified. */
export const MAX_CHECKED = 120

export interface SenderVerdicts {
  /** A NIP-05 that checks out. */
  verified: (pubkey: Hex) => boolean
  /** Proven to have no profile: the relays answered and none held a kind 0. */
  nobody: (pubkey: Hex) => boolean
}

/** NIP-05 and profile verdicts for many senders at once, unverified until proven. */
export function useVerifiedSenders(pubkeys: readonly Hex[]): SenderVerdicts {
  const wanted = useMemo(() => [...new Set(pubkeys)].slice(0, MAX_CHECKED), [pubkeys])
  const profiles = useQueries({ queries: wanted.map(pubkey => profileQuery(pubkey)) })

  const claims = wanted.map((pubkey, index) => {
    const profile = profiles[index]?.data ?? readCachedProfile(pubkey)?.profile
    const claim = profile?.nip05?.trim()
    return claim === undefined || claim === '' ? undefined : claim
  })
  const checks = useQueries({
    queries: wanted.flatMap((pubkey, index) => {
      const claim = claims[index]
      return claim === undefined ? [] : [nip05Query(pubkey, claim)]
    }),
  })

  const verdicts = new Map<Hex, boolean>()
  const absent = wanted.filter((pubkey, index) => profiles[index]?.data === null && readCachedProfile(pubkey) === undefined)
  let at = 0
  wanted.forEach((pubkey, index) => {
    const claim = claims[index]
    if (claim === undefined) return
    const answer = checks[at]?.data ?? readCachedNip05(pubkey, claim)?.ok
    at += 1
    if (answer === true) verdicts.set(pubkey, true)
  })
  const key = `${[...verdicts.keys()].sort().join(',')}|${absent.sort().join(',')}`

  return useMemo(() => {
    const none = new Set(absent)
    return {
      verified: (pubkey: Hex) => verdicts.get(pubkey) === true,
      nobody: (pubkey: Hex) => none.has(pubkey) && verdicts.get(pubkey) !== true,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the two sets are the signal
  }, [key])
}
