'use client'

import { useCallback, useMemo } from 'react'

import { useFollowerCount } from './followers'
import { gateFiles, mediaGate, type MediaGateInput, type MediaKind, type MediaVerdict } from './media-gate'
import { useProfile } from './profiles'
import { sessionPubkey, useSession } from '../components/SessionProvider'

/** The posting gate, wired to this reader's own profile and follower count. */
export interface MediaGate {
  /** The verdict for one kind, for disabling a control or explaining it before a click. */
  verdictFor: (kind: MediaKind) => MediaVerdict
  /** The verdict for a specific batch of files. */
  check: (files: readonly { type: string }[]) => MediaVerdict
}

export function useMediaGate(): MediaGate {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const profile = useProfile(pubkey)

  /* Asked only once the profile half is satisfied. */
  const profileOk = mediaGate('image', { profile, followers: Number.MAX_SAFE_INTEGER }).ok
  const followers = useFollowerCount(profileOk ? pubkey : undefined)

  const input = useMemo<MediaGateInput>(
    () => ({
      profile,
      /* `loading` decides unknown, NOT `count === 0`. */
      followers: !profileOk ? 0 : followers.loading ? undefined : followers.count,
    }),
    [profile, profileOk, followers.loading, followers.count],
  )

  const verdictFor = useCallback((kind: MediaKind) => mediaGate(kind, input), [input])
  const check = useCallback(
    (files: readonly { type: string }[]) => gateFiles(files, input),
    [input],
  )

  return { verdictFor, check }
}
