'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KINDS, type Hex } from '@nostrich/nostr'

import { getPool } from './pool'
import { readCachedStats, writeCachedStats } from './profile-cache'

/** When an account first appeared on Nostr. */

const YEAR_SECONDS = 365 * 24 * 3_600
/** Exponential brackets, in years back. */
const BRACKETS = [1, 2, 3, 4, 5, 6, 8, 10]
/** Bisection steps once the year is bracketed. */
const BISECT_STEPS = 6
const PROBE_TIMEOUT_MS = 5_000

/** The newest event at or before `until`, or null when the account has nothing that old. */
async function oldestBefore(pubkey: Hex, until: number): Promise<number | null> {
  // Reactions included: for a reader who mostly likes other people's notes, a kind-7.
  const kinds = [KINDS.metadata, KINDS.shortNote, KINDS.contacts, KINDS.reaction]
  const events = await getPool().query(
    [{ kinds, authors: [pubkey], until, limit: 1 }],
    undefined,
    PROBE_TIMEOUT_MS,
  )
  if (events.length === 0) return null
  return Math.min(...events.map(event => event.created_at))
}

async function findOldest(pubkey: Hex): Promise<number | null> {
  const now = Math.floor(Date.now() / 1000)

  // One round trip for the newest event, and all the brackets.
  const [latest, ...bracketed] = await Promise.all([
    oldestBefore(pubkey, now),
    ...BRACKETS.map(years => oldestBefore(pubkey, now - years * YEAR_SECONDS)),
  ])

  let oldest = latest
  for (const value of bracketed) {
    if (value !== null && (oldest === null || value < oldest)) oldest = value
  }
  if (oldest === null) return null

  // `low` is a cut-off known to return nothing, `high` one known to return something.
  let low = 0
  for (const [index, value] of bracketed.entries()) {
    if (value === null) {
      // The first empty bracket is the floor.
      low = now - BRACKETS[index]! * YEAR_SECONDS
      break
    }
  }
  let high = oldest

  for (let step = 0; step < BISECT_STEPS && high - low > 7 * 24 * 3_600; step += 1) {
    const middle = Math.floor((low + high) / 2)
    const found = await oldestBefore(pubkey, middle)
    if (found === null) {
      low = middle
    } else {
      // Found something older.
      oldest = Math.min(oldest, found)
      high = found
    }
  }

  return oldest
}

export function useJoinedAt(pubkey: Hex | undefined): number | undefined {
  /** The search above is nine parallel probes and then up to six SEQUENTIAL ones. */
  const cached = useMemo(() => readCachedStats(pubkey), [pubkey])

  const query = useQuery({
    queryKey: ['joined', pubkey ?? ''],
    queryFn: async () => {
      if (pubkey === undefined) return null
      const found = await findOldest(pubkey)
      if (found !== null) writeCachedStats(pubkey, { joined: found })
      return found
    },
    enabled: pubkey !== undefined,
    // This only moves when someone publishes something older than their oldest known.
    staleTime: 24 * 60 * 60 * 1000,
    ...(cached?.joined === undefined
      ? {}
      : { initialData: cached.joined, initialDataUpdatedAt: cached.at }),
  })
  return query.data ?? undefined
}
