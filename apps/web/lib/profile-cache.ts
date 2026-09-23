'use client'

import { advertisedHosts } from '@nostrich/nostr'
import type { Hex, Profile } from '@nostrich/nostr'

/** Names and avatars that survive a reload. */

const KEY = 'nostrich:profiles:v1'

/** Profiles kept on disk. */
const MAX_ENTRIES = 2_000

/** Past this the stored copy is dropped rather than shown: a year-old avatar. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000

/** Only the SHORT fields a surface paints before the network answers. */
interface StoredProfile {
  n?: string
  d?: string
  p?: string
  v?: string
  /** Cover image. A URL, so it is cheap, and its absence is very visible on a profile. */
  b?: string
  /** Lightning address. */
  l?: string
  /** The site the account advertises on its own profile. */
  w?: string
  /** The domains this account advertises, extracted at write time. */
  a?: string[]
  /** When this was written, so react-query can treat it as data of a known age. */
  t: number
}

type Store = Record<string, StoredProfile>

function load(): Store {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const cutoff = Date.now() - MAX_AGE_MS
    const out: Store = {}
    for (const [pubkey, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const entry = value as StoredProfile
      if (typeof entry.t !== 'number' || entry.t < cutoff) continue
      out[pubkey] = entry
    }
    return out
  } catch {
    // Corrupt or unreadable.
    return {}
  }
}

/** Read once, at module evaluation, so the first render already. */
const store: Store = load()

/** Pubkeys that must survive the cap: the accounts this browser is signed. */
const pinned = new Set<string>()

/** Called with the signed-in accounts, so the cap can never evict their profiles. */
export function pinProfiles(pubkeys: readonly Hex[]): void {
  for (const pubkey of pubkeys) pinned.add(pubkey)
}

/** Pubkeys written since the last flush. */
let dirty = false
let flushTimer: ReturnType<typeof setTimeout> | undefined

function flush(): void {
  flushTimer = undefined
  if (!dirty || typeof window === 'undefined') return
  dirty = false

  let entries = Object.entries(store)
  if (entries.length > MAX_ENTRIES) {
    /* Newest kept, EXCEPT the reader's own accounts, which are never evicted. */
    entries.sort((a, b) => {
      const pinnedA = pinned.has(a[0]) ? 1 : 0
      const pinnedB = pinned.has(b[0]) ? 1 : 0
      return pinnedB - pinnedA || b[1].t - a[1].t
    })
    entries = entries.slice(0, MAX_ENTRIES)
    for (const pubkey of Object.keys(store)) delete store[pubkey]
    for (const [pubkey, value] of entries) store[pubkey] = value
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Quota exceeded, or private mode.
    try {
      const half = entries.sort((a, b) => b[1].t - a[1].t).slice(0, Math.floor(MAX_ENTRIES / 2))
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(half)))
    } catch {
      // Give up quietly.
    }
  }
}

function schedule(): void {
  dirty = true
  // Coalesced: a screenful of notes resolves dozens of profiles within a few hundred.
  if (flushTimer === undefined) flushTimer = setTimeout(flush, 1_000)
}

export interface CachedProfile {
  profile: Profile
  /** Epoch ms. Handed to react-query as `initialDataUpdatedAt` so staleness is honest. */
  at: number
  /** Domains this account advertises. */
  hosts: readonly string[]
}

/** The last known profile for a pubkey, or undefined. */
export function readCachedProfile(pubkey: Hex): CachedProfile | undefined {
  const entry = store[pubkey]
  if (entry === undefined) return undefined
  return {
    profile: {
      pubkey,
      // The kind-0's own timestamp is not stored.
      updatedAt: 0,
      ...(entry.n === undefined ? {} : { name: entry.n }),
      ...(entry.d === undefined ? {} : { displayName: entry.d }),
      ...(entry.p === undefined ? {} : { picture: entry.p }),
      ...(entry.v === undefined ? {} : { nip05: entry.v }),
      ...(entry.b === undefined ? {} : { banner: entry.b }),
      ...(entry.l === undefined ? {} : { lud16: entry.l }),
      ...(entry.w === undefined ? {} : { website: entry.w }),
    },
    at: entry.t,
    hosts: entry.a ?? [],
  }
}

/** Profiles already on disk whose name or NIP-05 contains `needle`. */
export function searchCachedProfiles(needle: string, max: number): CachedProfile[] {
  const term = needle.trim().toLowerCase()
  if (term === '') return []
  const out: CachedProfile[] = []
  for (const [pubkey, entry] of Object.entries(store)) {
    const haystack = `${entry.n ?? ''} ${entry.d ?? ''} ${entry.v ?? ''}`.toLowerCase()
    if (!haystack.includes(term)) continue
    const hit = readCachedProfile(pubkey as Hex)
    if (hit !== undefined) out.push(hit)
    if (out.length >= max) break
  }
  return out
}

export function writeCachedProfile(pubkey: Hex, profile: Profile | null): void {
  if (profile === null) return
  const entry: StoredProfile = { t: Date.now() }
  if (profile.name !== undefined && profile.name !== '') entry.n = profile.name
  if (profile.displayName !== undefined && profile.displayName !== '') entry.d = profile.displayName
  if (profile.picture !== undefined && profile.picture !== '') entry.p = profile.picture
  if (profile.nip05 !== undefined && profile.nip05 !== '') entry.v = profile.nip05
  if (profile.banner !== undefined && profile.banner !== '') entry.b = profile.banner
  if (profile.lud16 !== undefined && profile.lud16 !== '') entry.l = profile.lud16
  if (profile.website !== undefined && profile.website !== '') entry.w = profile.website
  const hosts = advertisedHosts(profile)
  if (hosts.length > 0) entry.a = hosts
  // Nothing worth painting.
  if (entry.n === undefined && entry.d === undefined && entry.p === undefined) return

  store[pubkey] = entry
  schedule()
}

/** Drop one profile from the disk cache. */
export function forgetCachedProfile(pubkey: Hex): void {
  if (store[pubkey] === undefined) return
  delete store[pubkey]
  schedule()
}

// --------------------------------------------------------------------------- NIP-05.

const NIP05_KEY = 'nostrich:nip05:v1'
/** A verdict is a fact about a well-known document, which changes rarely. */
const NIP05_MAX_AGE_MS = 24 * 60 * 60 * 1_000

type Verdicts = Record<string, { ok: boolean; t: number }>

function loadVerdicts(): Verdicts {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(NIP05_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const cutoff = Date.now() - NIP05_MAX_AGE_MS
    const out: Verdicts = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const entry = value as { ok?: unknown; t?: unknown }
      if (typeof entry.ok !== 'boolean' || typeof entry.t !== 'number' || entry.t < cutoff) continue
      out[key] = { ok: entry.ok, t: entry.t }
    }
    return out
  } catch {
    return {}
  }
}

const verdicts: Verdicts = loadVerdicts()
let verdictTimer: ReturnType<typeof setTimeout> | undefined

/** The badge, remembered. */
export function readCachedNip05(pubkey: Hex, claim: string): { ok: boolean; at: number } | undefined {
  const entry = verdicts[`${pubkey}|${claim}`]
  return entry === undefined ? undefined : { ok: entry.ok, at: entry.t }
}

export function writeCachedNip05(pubkey: Hex, claim: string, ok: boolean): void {
  verdicts[`${pubkey}|${claim}`] = { ok, t: Date.now() }
  if (verdictTimer !== undefined) return
  verdictTimer = setTimeout(() => {
    verdictTimer = undefined
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(NIP05_KEY, JSON.stringify(verdicts))
    } catch {
      // Quota.
    }
  }, 1_000)
}

// --------------------------------------------------------------------------- Profile.

const STATS_KEY = 'nostrich:profile-stats:v1'

/** The two numbers under a profile's name that the reader watches arrive. */
interface StoredStats {
  /** Followers. */
  f?: number
  /** Whether that count is a floor rather than a total. */
  c?: boolean
  /** Joined: the oldest event we could find, in epoch SECONDS like every Nostr timestamp. */
  j?: number
  /** Written at, epoch ms. Handed to react-query as `initialDataUpdatedAt`. */
  t: number
}

/** Smaller entries than a profile, and fewer profiles are opened than are seen. */
const MAX_STATS = 400

let stats: Record<string, StoredStats> = readStats()
let statsDirty = false
let statsTimer: ReturnType<typeof setTimeout> | undefined

function readStats(): Record<string, StoredStats> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STATS_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const now = Date.now()
    const out: Record<string, StoredStats> = {}
    for (const [pubkey, value] of Object.entries(parsed as Record<string, StoredStats>)) {
      if (typeof value?.t !== 'number') continue
      if (now - value.t > MAX_AGE_MS) continue
      out[pubkey] = value
    }
    return out
  } catch {
    return {}
  }
}

function flushStats(): void {
  statsTimer = undefined
  if (!statsDirty || typeof window === 'undefined') return
  statsDirty = false
  let entries = Object.entries(stats)
  if (entries.length > MAX_STATS) {
    entries.sort((a, b) => b[1].t - a[1].t)
    entries = entries.slice(0, MAX_STATS)
    stats = Object.fromEntries(entries)
  }
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Quota or private mode.
  }
}

function scheduleStats(): void {
  statsDirty = true
  if (statsTimer === undefined) statsTimer = setTimeout(flushStats, 1_000)
}

export interface CachedStats {
  followers?: number
  capped?: boolean
  joined?: number
  /** Epoch ms. */
  at: number
}

/** Synchronous, for the same reason `readCachedProfile` is: it is read during a render. */
export function readCachedStats(pubkey: Hex | undefined): CachedStats | undefined {
  if (pubkey === undefined) return undefined
  const entry = stats[pubkey]
  if (entry === undefined) return undefined
  return {
    ...(entry.f === undefined ? {} : { followers: entry.f }),
    ...(entry.c === undefined ? {} : { capped: entry.c }),
    ...(entry.j === undefined ? {} : { joined: entry.j }),
    at: entry.t,
  }
}

/** Merged, not replaced: followers and the join date arrive from two different queries. */
export function writeCachedStats(pubkey: Hex, next: Omit<CachedStats, 'at'>): void {
  const entry: StoredStats = { ...(stats[pubkey] ?? {}), t: Date.now() }
  if (next.followers !== undefined) entry.f = next.followers
  if (next.capped !== undefined) entry.c = next.capped
  if (next.joined !== undefined) entry.j = next.joined
  stats[pubkey] = entry
  scheduleStats()
}
