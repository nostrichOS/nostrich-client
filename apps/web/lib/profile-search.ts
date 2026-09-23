'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  KINDS,
  SEARCH_RELAYS,
  normalizeHexKey,
  parseProfile,
  profileDisplayName,
  type Hex,
  type NostrEvent,
} from '@nostrich/nostr'

import { resolveEntity } from './entity'
import { getPool } from './pool'
import { rememberEvents } from './event-cache'
import { searchCachedProfiles } from './profile-cache'

/** Finding people by name. */

/** The fields a result row draws. */
export interface ProfileSummary {
  pubkey: Hex
  name?: string
  displayName?: string
  nip05?: string
  about?: string
  picture?: string
}

export interface ProfileHit extends ProfileSummary {
  /** True when the term was an npub/nprofile/hex rather than a name. */
  exact?: boolean
}

export interface ProfileSearchResult {
  profiles: ProfileHit[]
  loading: boolean
  /** True when no search relay answered and only local matches are shown. */
  degraded: boolean
}

const NONE: ProfileHit[] = []

export function useProfileSearch(term: string, enabled: boolean): ProfileSearchResult {
  const query = term.trim()

  /** An npub, nprofile or bare hex key typed straight into the box. */
  const pasted = useMemo((): Hex | undefined => {
    if (query === '') return undefined
    const hex = normalizeHexKey(query)
    if (hex !== null) return hex
    const resolved = resolveEntity(query, 'profile')
    return resolved?.kind === 'profile' ? resolved.hex : undefined
  }, [query])

  const active = enabled && query !== '' && pasted === undefined

  /** Free, synchronous, and the reason a known name can never come back empty. */
  const local = useMemo((): ProfileHit[] => {
    if (!active) return []
    return searchCachedProfiles(query, 20).map(({ profile }) => ({
      pubkey: profile.pubkey,
      ...(profile.name === undefined ? {} : { name: profile.name }),
      ...(profile.displayName === undefined ? {} : { displayName: profile.displayName }),
      ...(profile.nip05 === undefined ? {} : { nip05: profile.nip05 }),
      ...(profile.picture === undefined ? {} : { picture: profile.picture }),
    }))
  }, [active, query])

  const search = useQuery({
    queryKey: ['profile-search', query],
    queryFn: async (): Promise<{ found: ProfileSummary[]; reachable: boolean }> => {
      const found = await searchRelayProfiles(query)
      return { found: found ?? [], reachable: found !== null }
    },
    // A pasted key is already an answer.
    enabled: active,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  const profiles = useMemo((): ProfileHit[] => {
    if (pasted !== undefined) return [{ pubkey: pasted, exact: true }]

    // Deduped by pubkey, keeping the FIRST description of each account.
    const seen = new Set<Hex>()
    const merged: ProfileHit[] = []
    for (const hit of [...local, ...(search.data?.found ?? [])]) {
      if (seen.has(hit.pubkey)) continue
      seen.add(hit.pubkey)
      merged.push(hit)
    }

    // Sorted by how well the name matches, not by the order the relays sent.
    const needle = query.toLowerCase()
    return merged.sort((a, b) => rank(a, needle) - rank(b, needle))
  }, [pasted, local, search.data, query])

  return {
    profiles: profiles.length === 0 ? NONE : profiles,
    loading: search.isPending && active,
    degraded: search.data !== undefined && !search.data.reachable,
  }
}

/** People, from the relays that implement NIP-50 on kind 0. Filtered locally afterwards. */
/** How many profiles to ask each search relay. */
const PEOPLE_LIMIT = 300

/** NULL means no relay answered, which is not the same as nobody matching. */
async function searchRelayProfiles(query: string): Promise<ProfileSummary[] | null> {
  const needle = query.trim().toLowerCase().replace(/^@+/, '')
  if (needle === '') return []
  let events: NostrEvent[] = []
  try {
    events = await getPool().query(
      [{ kinds: [KINDS.metadata], search: needle, limit: PEOPLE_LIMIT } as never],
      [...SEARCH_RELAYS],
      6_000,
    )
  } catch {
    // The local cache still stands.
    return null
  }
  rememberEvents(events)

  const out: ProfileSummary[] = []
  for (const event of events) {
    const profile = parseProfile(event)
    const haystack =
      `${profile.name ?? ''} ${profile.displayName ?? ''} ${profile.nip05 ?? ''}`.toLowerCase()
    if (!haystack.includes(needle)) continue
    out.push({
      pubkey: event.pubkey,
      ...(profile.name === undefined ? {} : { name: profile.name }),
      ...(profile.displayName === undefined ? {} : { displayName: profile.displayName }),
      ...(profile.nip05 === undefined ? {} : { nip05: profile.nip05 }),
      ...(profile.about === undefined ? {} : { about: profile.about }),
      ...(profile.picture === undefined ? {} : { picture: profile.picture }),
    })
  }
  return out
}

/** Lower sorts first: exact name, then prefix, then anything else. */
function rank(profile: ProfileSummary, needle: string): number {
  const name = profileDisplayName(profile).toLowerCase()
  const handle = (profile.nip05 ?? '').toLowerCase()
  if (name === needle || handle.split('@')[0] === needle) return 0
  if (name.startsWith(needle)) return 1
  if (handle.startsWith(needle)) return 2
  if (name.includes(needle)) return 3
  return 4
}
