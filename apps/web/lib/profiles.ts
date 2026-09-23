'use client'

import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import {
  DEFAULT_INDEXER_RELAYS,
  DEFAULT_RELAYS,
  KINDS,
  isPrivateUrl,
  normalizeRelayUrls,
  parseProfile,
  pickLatestMetadata,
  profileDisplayName,
  verifyNip05,
  type Hex,
  type NostrEvent,
  type Profile,
  type RelayUrl,
} from '@nostrich/nostr'

import { getPool } from './pool'
import { profileHints } from './profile-hints'
import {
  readCachedNip05,
  readCachedProfile,
  writeCachedNip05,
  writeCachedProfile,
} from './profile-cache'

/** Long enough to collect the authors of a screenful, short enough that nobody waits. */
const BATCH_WINDOW_MS = 90
/** Relays reject oversized filters. */
const MAX_BATCH = 120
const QUERY_TIMEOUT_MS = 6_000

/** The follow-up to relays a mention named, when our own set had nothing. */
const MAX_HINT_RELAYS = 2
/** Relays added from NIP-65 write lists, on top of the hint relays above. */
const MAX_OUTBOX_RELAYS = 2
const HINT_TIMEOUT_MS = 3_000

/** Indexers first: purplepag.es and friends exist to hold kind-0 for the whole. */
const PROFILE_RELAYS: RelayUrl[] = normalizeRelayUrls([...DEFAULT_INDEXER_RELAYS, ...DEFAULT_RELAYS])

/** Relays these authors' mentions pointed at, minus the ones we already query. */
function extraRelaysFromHints(missing: readonly Hex[]): RelayUrl[] {
  return [...new Set(missing.flatMap(pubkey => profileHints(pubkey)))]
    .filter(relay => !PROFILE_RELAYS.includes(relay))
    .slice(0, MAX_HINT_RELAYS)
}

/** Batches in the air. */
const MAX_CONCURRENT_BATCHES = 2

type Resolver = {
  resolve: (profile: Profile | null) => void
  reject: (error: Error) => void
}

let queue = new Map<Hex, Resolver[]>()
let timer: ReturnType<typeof setTimeout> | undefined
/** Lookups already on the wire, so a second caller attaches instead of opening a new. */
const inFlight = new Map<Hex, Promise<Profile | null>>()
let running = 0

/** One kind-0 filter for many authors. */
export function loadProfile(pubkey: Hex): Promise<Profile | null> {
  // Already on the wire.
  const airborne = inFlight.get(pubkey)
  if (airborne !== undefined) return airborne

  return new Promise<Profile | null>((resolve, reject) => {
    const waiting = queue.get(pubkey)
    if (waiting !== undefined) {
      waiting.push({ resolve, reject })
      return
    }
    queue.set(pubkey, [{ resolve, reject }])

    if (queue.size >= MAX_BATCH) {
      flush()
      return
    }
    if (timer === undefined) timer = setTimeout(flush, BATCH_WINDOW_MS)
  })
}

function flush(): void {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  if (queue.size === 0) return
  // Wait for a slot rather than adding to the pile.
  if (running >= MAX_CONCURRENT_BATCHES) return

  const batch = queue
  queue = new Map()

  const authors = [...batch.keys()]
  running += 1
  /** Per author: the profile the batch found, or the reason there is no answer to give. */
  type Outcome = { profile: Profile | null } | { error: Error }

  /* ── EVERY AUTHOR IS HANDED OVER THE MOMENT THEIR OWN kind-0 LANDS ──────────────────. */
  const announced = new Set<Hex>()
  /** `created_at` of the event we announced, so a newer one arriving late can correct. */
  const announcedAt = new Map<Hex, number>()
  /** Settles the promise held by callers who arrived AFTER this batch went out. */
  const settleShared = new Map<Hex, (outcome: Outcome) => void>()
  /** What each author was announced WITH, kept because the announcement can beat. */
  const announcedOutcome = new Map<Hex, Outcome>()

  const announce = (pubkey: Hex, outcome: Outcome): void => {
    if (announced.has(pubkey)) return
    announced.add(pubkey)
    announcedOutcome.set(pubkey, outcome)
    const resolvers = batch.get(pubkey) ?? []
    if ('error' in outcome) for (const { reject } of resolvers) reject(outcome.error)
    else for (const { resolve } of resolvers) resolve(outcome.profile)
    settleShared.get(pubkey)?.(outcome)
  }

  /* The first copy wins, and a newer one CORRECTS it rather than being waited. */
  const onArrival = (event: NostrEvent): void => {
    const author = event.pubkey.toLowerCase() as Hex
    if (!batch.has(author) || announced.has(author)) return
    announcedAt.set(author, event.created_at)
    announce(author, { profile: parseProfile(event) })
  }

  const work = (async (): Promise<Map<Hex, Outcome>> => {
    /** `queryWithStatus`, because "nobody answered" and "nobody has one" are different. */
    let events: NostrEvent[] = []
    let answered = 0
    let failure: Error | undefined
    try {
      const outcome = await getPool().queryWithStatus(
        [{ kinds: [KINDS.metadata], authors }],
        PROFILE_RELAYS,
        QUERY_TIMEOUT_MS,
        { onEvent: onArrival },
      )
      events = outcome.events
      answered = outcome.answered
    } catch (error) {
      // A dead relay set is not a reason to leave every avatar spinning forever.
      failure = error instanceof Error ? error : new Error('profile query failed')
    }

    const byAuthor = new Map<Hex, NostrEvent[]>()
    for (const event of events) {
      const author = event.pubkey.toLowerCase()
      const existing = byAuthor.get(author)
      if (existing === undefined) byAuthor.set(author, [event])
      else existing.push(event)
    }

    /** A SECOND LOOK, where the mention said to look. */
    const missing = authors.filter(pubkey => (byAuthor.get(pubkey) ?? []).length === 0)
    /** Two sources for the second look, in priority order. */
    const reached = [...PROFILE_RELAYS, ...extraRelaysFromHints(missing)]
    const extraRelays = [...extraRelaysFromHints(missing)]
    if (missing.length > 0 && extraRelays.length > 0) {
      try {
        const hinted = await getPool().query(
          [{ kinds: [KINDS.metadata], authors: missing }],
          extraRelays,
          HINT_TIMEOUT_MS,
          // Same rule: a name that arrives from a hinted relay is shown when it arrives.
          { onEvent: onArrival },
        )
        for (const event of hinted) {
          const author = event.pubkey.toLowerCase() as Hex
          if (!missing.includes(author)) continue
          const existing = byAuthor.get(author)
          if (existing === undefined) byAuthor.set(author, [event])
          else existing.push(event)
        }
      } catch {
        // A hinted relay that will not talk is exactly the situation this is a bonus.
      }
    }

    /** How many relays must have spoken before "no profile" is believable. */
    const quorum = Math.ceil(PROFILE_RELAYS.length / 2)
    const trustAbsence = failure === undefined && answered >= quorum

    const outcomes = new Map<Hex, Outcome>()
    for (const [pubkey, resolvers] of batch) {
      // Relays disagree about which kind-0 is current.
      const latest = pickLatestMetadata(byAuthor.get(pubkey) ?? [])
      const outcome: Outcome =
        latest !== undefined
          ? // Found is found, however few relays answered.
            { profile: parseProfile(latest) }
          : trustAbsence
            ? { profile: null }
            : {
                error:
                  failure ??
                  new Error(
                    `only ${answered}/${PROFILE_RELAYS.length} relays answered for ${pubkey}`,
                  ),
              }
      outcomes.set(pubkey, outcome)
      /* Already handed over on arrival. */
      if (announced.has(pubkey)) {
        const shown = announcedAt.get(pubkey)
        if (latest !== undefined && shown !== undefined && latest.created_at > shown) {
          const newer = parseProfile(latest)
          sharedClient?.setQueryData(['profile', pubkey], newer)
          writeCachedProfile(pubkey, newer)
        }
        continue
      }
      announce(pubkey, outcome)
    }
    return outcomes
  })()

  /* Every author in this batch shares one lookup, so a caller arriving mid-flight. */
  for (const pubkey of authors) {
    const shared = new Promise<Profile | null>((resolve, reject) => {
      const settle = (outcome: Outcome): void => {
        if ('error' in outcome) reject(outcome.error)
        else resolve(outcome.profile)
      }
      // Announced already.
      const already = announcedOutcome.get(pubkey)
      if (already !== undefined) settle(already)
      else settleShared.set(pubkey, settle)
    })
    inFlight.set(pubkey, shared)
    // Attached-to later or not at all, an unhandled rejection must not reach the console.
    void shared.catch(() => {})
  }

  void work
    .catch((error: unknown) => {
      /* The batch itself threw. */
      const reason = error instanceof Error ? error : new Error('profile batch failed')
      for (const pubkey of authors) announce(pubkey, { error: reason })
    })
    .finally(() => {
      running -= 1
      for (const pubkey of authors) inFlight.delete(pubkey)
      // A slot came free and callers may have been collecting the whole time.
      if (queue.size > 0) flush()
    })
}

/** The cache entry for one profile, shared by the note renderer and the feed's quality. */
export function profileQuery(pubkey: Hex) {
  /** The disk copy paints the first frame, and is ALWAYS revalidated. */
  return {
    queryKey: ['profile', pubkey] as const,
    queryFn: async (): Promise<Profile | null> => {
      const fresh = await loadProfile(pubkey)
      /** A PROFILE WE ALREADY HAVE IS NEVER REPLACED BY NOTHING. */
      if (fresh === null) {
        const held = readCachedProfile(pubkey)?.profile
        if (held !== undefined) return held
      }
      writeCachedProfile(pubkey, fresh)
      return fresh
    },
    /** An absence is a much weaker claim than a presence, and expires much sooner. */
    // Structurally typed rather than `Query<…>`: this descriptor is spread into useQuery.
    staleTime: (query: { state: { data?: Profile | null } }) =>
      query.state.data === null ? 30_000 : 5 * 60_000,
    gcTime: 30 * 60_000,
    /** The one query that overrides the global `retry: false` (see Providers.tsx). */
    retry: 2,
    retryDelay: (attempt: number) => (attempt === 0 ? 800 : 2_500),
  }
}

/** Put the disk copy into the query cache. */
function seedFromDisk(client: QueryClient, pubkey: Hex): void {
  const key = ['profile', pubkey] as const
  // Never over data the network has already given us, and never twice.
  if (client.getQueryData(key) !== undefined) return
  const cached = readCachedProfile(pubkey)
  if (cached === undefined) return
  client.setQueryData(key, cached.profile, { updatedAt: 0 })
}

/** As above, for a NIP-05 claim. */
export function nip05Query(pubkey: Hex, claim: string) {
  return {
    queryKey: ['nip05', pubkey, claim] as const,
    queryFn: async (): Promise<boolean> => {
      try {
        const status = await verifyNip05(claim, pubkey)
        writeCachedNip05(pubkey, claim, status.verified)
        return status.verified
      } catch {
        /* A well-known document that will not load is not a verified one. */
        writeCachedNip05(pubkey, claim, false)
        return false
      }
    },
    /** A day, not an hour. */
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  }
}

/** Learn who wrote something before it is on screen. */
/** The QueryClient, so a late answer can reach the avatars already on screen. */
let sharedClient: QueryClient | undefined

/** Authors already given a second chance, so a permanent absence is asked. */
const repaired = new Set<Hex>()

export async function prefetchProfiles(
  client: QueryClient,
  pubkeys: readonly Hex[],
): Promise<void> {
  await Promise.all(
    /* The PROFILE is prefetched. */
    pubkeys.map(async pubkey => {
      await client.prefetchQuery(profileQuery(pubkey))
    }),
  )
}

export function useProfile(pubkey: Hex | undefined): Profile | null {
  const key = pubkey ?? ''
  const client = useQueryClient()
  // Before the query renders anything of its own, and after hydration has finished.
  useEffect(() => {
    // Registered here because every avatar mounts this hook.
    sharedClient = client
    if (key !== '') seedFromDisk(client, key)
  }, [client, key])
  const query = useQuery({ ...profileQuery(key), enabled: key !== '' })
  return query.data ?? null
}

/** A NIP-05 claim on its own means nothing. */
export function useNip05Verified(identifier: string | undefined, pubkey: Hex): boolean {
  const claim = identifier ?? ''
  const client = useQueryClient()
  /* The tick, seeded the same way and for the same reason. */
  useEffect(() => {
    if (claim === '') return
    const key = ['nip05', pubkey, claim] as const
    if (client.getQueryData(key) !== undefined) return
    const cached = readCachedNip05(pubkey, claim)
    if (cached !== undefined) client.setQueryData(key, cached.ok, { updatedAt: cached.at })
  }, [client, pubkey, claim])
  const query = useQuery({ ...nip05Query(pubkey, claim), enabled: claim !== '' })
  return query.data === true
}

/** Display names for a handful of mentioned accounts. */
export function useMentionNames(pubkeys: readonly Hex[]): (pubkey: Hex) => string | undefined {
  // Bounded: a note listing forty accounts is a spam pattern, and resolving all of them.
  const wanted = useMemo(() => [...new Set(pubkeys)].slice(0, 12), [pubkeys])

  const results = useQueries({
    queries: wanted.map(pubkey => ({ ...profileQuery(pubkey), enabled: true })),
  })

  return useMemo(() => {
    const names = new Map<Hex, string>()
    for (const [index, result] of results.entries()) {
      const pubkey = wanted[index]
      const profile = result.data
      if (pubkey === undefined || profile === null || profile === undefined) continue
      const name = profileDisplayName(profile).trim()
      // profileDisplayName falls back to a shortened npub, which is what we are replacing.
      if (name === '' || name.startsWith('npub1')) continue
      names.set(pubkey, name)
    }
    return (pubkey: Hex): string | undefined => names.get(pubkey)
  }, [results, wanted])
}
