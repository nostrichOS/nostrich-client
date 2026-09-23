'use client'

import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Hex, Profile } from '@nostrich/nostr'

import { readCachedNip05, readCachedProfile } from './profile-cache'
import { nip05Query, profileQuery } from './profiles'
import type { SocialGraphApi } from './social-graph'
import { useUserListsVersion } from './user-lists'
import type { TrustContext } from './trust'

/** Assembles a `TrustContext` from caches that are already populated. */
export function useTrustContext(
  viewer: Hex | undefined,
  socialGraph: SocialGraphApi,
): TrustContext {
  const client = useQueryClient()
  // Re-derives the context when a mute changes, so the feed re-filters immediately.
  const muteVersion = useUserListsVersion()

  const profileFor = useCallback(
    (pubkey: Hex): Profile | undefined => {
      const fresh = client.getQueryData<Profile | null>(profileQuery(pubkey).queryKey)
      if (fresh !== undefined && fresh !== null) return fresh
      return readCachedProfile(pubkey)?.profile
    },
    [client],
  )

  const nip05Verified = useCallback(
    (pubkey: Hex): boolean => {
      const claim = profileFor(pubkey)?.nip05
      if (claim === undefined || claim.trim() === '') return false
      const fresh = client.getQueryData<boolean>(nip05Query(pubkey, claim).queryKey)
      if (fresh !== undefined) return fresh
      // Only a remembered PASS counts.
      return readCachedNip05(pubkey, claim)?.ok === true
    },
    [client, profileFor],
  )

  return useMemo(
    () => ({
      ...(viewer === undefined ? {} : { viewer }),
      // The crawl publishes distance-1 before it finishes, but `ready` is the only honest.
      graphReady: socialGraph.ready && socialGraph.root !== undefined,
      distance: socialGraph.distance,
      profileFor,
      nip05Verified,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- muteVersion is the signal
    [viewer, socialGraph, profileFor, nip05Verified, muteVersion],
  )
}
