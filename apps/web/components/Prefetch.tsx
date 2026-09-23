'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Hex } from '@nostrich/nostr'

import { useExploreData } from '../lib/explore'
import { forgetAccountProfiles, writeAccountProfile } from '../lib/account-profiles'
import { pinProfiles } from '../lib/profile-cache'
import { profileQuery } from '../lib/profiles'
import { sessionPubkey, useSession } from './SessionProvider'
import { useLikes } from '../lib/likes'
import { useProfile } from '../lib/profiles'
import { useProfileZaps } from '../lib/profile-zaps'

/** The pages you have not opened yet, fetched while you are reading the one you did. */
export function Prefetch({ pubkey }: { pubkey: Hex | undefined }): React.ReactNode {
  // Not gated on idle: the account switcher is one click away at any moment.
  useOwnProfiles()

  const ready = useAfterIdle()
  // Mounted, not merely enabled: several of these hooks have no `enabled` flag.
  return ready ? <Warm pubkey={pubkey} /> : null
}

/** When to start. */
function useAfterIdle(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // Metered connections and Save-Data opt out entirely.
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string }
      }
    ).connection
    if (connection?.saveData === true) return
    if (connection?.effectiveType !== undefined && /^(slow-)?2g$/.test(connection.effectiveType)) {
      return
    }

    const start = (): void => setReady(true)
    const idle = (
      window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
        cancelIdleCallback?: (handle: number) => void
      }
    ).requestIdleCallback
    if (idle === undefined) {
      const timer = window.setTimeout(start, IDLE_TIMEOUT_MS)
      return () => window.clearTimeout(timer)
    }
    const handle = idle(start, { timeout: IDLE_TIMEOUT_MS })
    return () => {
      ;(window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(
        handle,
      )
    }
  }, [])
  return ready
}

/** Long enough that the visible page owns the network while it is painting. */
const IDLE_TIMEOUT_MS = 2_000

/** The page hooks, mounted with no page. */
function Warm({ pubkey }: { pubkey: Hex | undefined }): React.ReactNode {
  const profile = useProfile(pubkey)

  // Notifications: the backlog, the follower and bookmark stores, and the note each row.
  /* The notifications page is NOT warmed here any more. */

  /** Zaps, LAST and on a delay. */
  // `warm`: this observer must not force a refetch on mount.
  useProfileZaps(pubkey, profile, useDelayed(ZAPS_WARM_DELAY_MS), true)

  // History → Likes.
  useLikes()

  // Explore.
  useExploreData(true)

  /* ARTICLES ARE NOT WARMED, and this is the second time that decision. */

  return null
}

/** How long the zap ledger waits before warming. */
const ZAPS_WARM_DELAY_MS = 6_000

/** True once `ms` have passed since mount, so a warm-up can be told to go last. */
function useDelayed(ms: number): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), ms)
    return () => clearTimeout(timer)
  }, [ms])
  return ready
}

/** The reader's OWN accounts, kept resolvable. */
function useOwnProfiles(): void {
  const { accounts } = useSession()
  const client = useQueryClient()
  const key = accounts.map(account => account.pubkey).join(',')

  useEffect(() => {
    const pubkeys = key === '' ? [] : (key.split(',') as Hex[])
    if (pubkeys.length === 0) return
    pinProfiles(pubkeys)

    // Anyone signed out is dropped, so the durable store holds only current accounts.
    forgetAccountProfiles(pubkeys)

    let alive = true
    void (async () => {
      for (let attempt = 0; attempt < OWN_PROFILE_TRIES && alive; attempt += 1) {
        const results = await Promise.all(
          pubkeys.map(pubkey => client.ensureQueryData(profileQuery(pubkey)).catch(() => null)),
        )
        // Written through to the uncapped store the switcher reads.
        for (const [index, profile] of results.entries()) {
          writeAccountProfile(pubkeys[index]!, profile)
        }
        // Everyone resolved to an actual profile: nothing left to retry.
        if (results.every(profile => profile !== null)) return
        await new Promise(done => setTimeout(done, OWN_PROFILE_RETRY_MS * (attempt + 1)))
        if (!alive) return
        // Drop the nulls so the next pass is a real fetch rather than a cache read.
        for (const [index, profile] of results.entries()) {
          if (profile === null) client.removeQueries({ queryKey: ['profile', pubkeys[index]] })
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [key, client])
}

/** Enough to ride out a bad minute on the relays, not enough to hammer them. */
const OWN_PROFILE_TRIES = 4
const OWN_PROFILE_RETRY_MS = 4_000
