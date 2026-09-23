'use client'

import type { Hex } from '@nostrich/nostr'

import { useFollows } from './contacts'
import { useFollowerCount } from './followers'

/** How many people an account follows, and how many follow. */
export interface ProfileTotals {
  following: number
  followers: number
  /** False while no source has answered yet. */
  followingReady: boolean
  followersReady: boolean
  /** The relay count hit its ceiling, so the figure is a floor and should be shown. */
  followersCapped: boolean
  /** The follower figure is the index's network-wide total rather than a relay floor. */
  followersAreNetworkWide: boolean
}

export function useProfileTotals(pubkey: Hex | undefined): ProfileTotals {
  const follows = useFollows(pubkey)
  const followers = useFollowerCount(pubkey)
  return {
    /** From the reader's own kind-3, which is already right. */
    following: follows.total,
    followers: followers.count,
    followingReady: follows.resolved,
    followersReady: !followers.loading,
    followersCapped: followers.capped,
    /* Always a floor, never a network-wide total: a follower count assembled from contact. */
    followersAreNetworkWide: false,
  }
}
