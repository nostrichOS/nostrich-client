'use client'

import { useQuery } from '@tanstack/react-query'
import {
  DEFAULT_INDEXER_RELAYS,
  DEFAULT_RELAYS,
  KINDS,
  normalizeRelayUrls,
  nowSeconds,
  parseContacts,
  type EventTemplate,
  type Hex,
  type NostrEvent,
  type RelayUrl,
} from '@nostrich/nostr'

import { getPool } from './pool'
import { activeScope, readScoped, writeScoped } from './scope'

/** Ceiling on the follow list we will build a feed. */
export const MAX_FOLLOWS = 2_500
const QUERY_TIMEOUT_MS = 6_000

/** Where to look for a kind-3. `wss://purplepag.es` is here and NOT in DEFAULT_RELAYS. */
/** Where a contact list is read. */
export const CONTACT_RELAYS: RelayUrl[] = normalizeRelayUrls([
  'wss://purplepag.es',
  ...DEFAULT_INDEXER_RELAYS,
  ...DEFAULT_RELAYS,
])

/** Shared instance: the feed subscription keys off the identity of this array. */
const NO_AUTHORS: Hex[] = []

/** NIP-01 replaceable tie-break: newest wins, lowest id breaks a tie on the second. */
function newest(events: readonly NostrEvent[]): NostrEvent | undefined {
  let best: NostrEvent | undefined
  for (const event of events) {
    if (event.kind !== KINDS.contacts) continue
    if (best === undefined || event.created_at > best.created_at) {
      best = event
      continue
    }
    if (event.created_at === best.created_at && event.id < best.id) best = event
  }
  return best
}

export interface FollowsResult {
  /** Capped at MAX_FOLLOWS. */
  authors: Hex[]
  /** Every pubkey on the list, uncapped. */
  all: Hex[]
  /** How many accounts the contact list actually names. */
  total: number
  loading: boolean
  /** True once we have looked and found nothing. */
  resolved: boolean
}

/** THE NEWEST CONTACT LIST THIS BROWSER HAS EVER SEEN, per account. */
const highWater = new Map<Hex, NostrEvent>()

/** …and it OUTLIVES THE SESSION. */
const STORE_KEY = 'nostrich:contacts:v1'
/** Roughly 3,000 follows. */
const MAX_STORED_BYTES = 250_000

function loadStored(pubkey: Hex): NostrEvent | undefined {
  const raw = readScoped(STORE_KEY)
  if (raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const event = parsed as NostrEvent
    // Somebody else's list in this account's slot is worse than none: it would.
    if (event.pubkey !== pubkey || event.kind !== KINDS.contacts) return undefined
    if (!Array.isArray(event.tags) || typeof event.created_at !== 'number') return undefined
    return event
  } catch {
    return undefined
  }
}

/** The newest kind-3 seen for this account, from any read. */
export function latestContacts(pubkey: Hex): NostrEvent | undefined {
  const held = highWater.get(pubkey)
  if (held !== undefined) return held
  const stored = loadStored(pubkey)
  if (stored !== undefined) highWater.set(pubkey, stored)
  return stored
}

/** Remembers `event` if it is newer than what is held. */
export function rememberContacts(event: NostrEvent): NostrEvent {
  const pubkey = event.pubkey as Hex
  const held = latestContacts(pubkey)
  const best = newest(held === undefined ? [event] : [held, event])
  // `newest` cannot return undefined here.
  const winner = best ?? event
  highWater.set(pubkey, winner)
  if (winner === event) {
    const serialised = JSON.stringify(event)
    // Only for the account in front: `writeScoped` writes to the active scope, and a list.
    if (serialised.length <= MAX_STORED_BYTES && activeScope() === pubkey) {
      writeScoped(STORE_KEY, serialised)
    }
  }
  return winner
}

/** For tests, and for a sign-out that should leave nothing behind. */
export function forgetContacts(): void {
  highWater.clear()
}

/** Ask every relay again, right now, and take the newest answer. */
/** The relays to ask for ONE person's contact list. */
function contactRelaysFor(pubkey: Hex): RelayUrl[] {
  return [...CONTACT_RELAYS]
}

export async function refreshContacts(pubkey: Hex): Promise<NostrEvent | undefined> {
  try {
    const events = await getPool().query(
      [{ kinds: [KINDS.contacts], authors: [pubkey], limit: 1 }],
      contactRelaysFor(pubkey),
      QUERY_TIMEOUT_MS,
    )
    const answer = newest(events)
    if (answer !== undefined) rememberContacts(answer)
  } catch {
    // Offline, or every relay refused.
  }
  return latestContacts(pubkey)
}

/** The contact list with one person added or removed. */
export function editContacts(
  previous: NostrEvent | undefined,
  target: Hex,
  follow: boolean,
): EventTemplate {
  const tags: string[][] = (previous?.tags ?? [])
    .map(tag => [...tag])
    .filter(tag => !(tag[0] === 'p' && tag[1] === target))
  if (follow) tags.push(['p', target])
  return {
    kind: KINDS.contacts,
    /* Never older than what it replaces. */
    created_at: Math.max(nowSeconds(), (previous?.created_at ?? 0) + 1),
    // Kept verbatim.
    content: previous?.content ?? '',
    tags,
  }
}

/** Whether a list is small enough, compared with what it replaces, to be a mistake. */
export function losesFollows(previous: NostrEvent | undefined, next: EventTemplate): number {
  if (previous === undefined) return 0
  const before = new Set(
    previous.tags.filter(tag => tag[0] === 'p').map(tag => tag[1] as string),
  )
  const after = new Set(next.tags.filter(tag => tag[0] === 'p').map(tag => tag[1] as string))
  let lost = 0
  for (const pubkey of before) if (!after.has(pubkey)) lost += 1
  return lost
}

/** Shape the persisted contact list into what the query returns, or undefined. */
export function followsFrom(key: string): { authors: Hex[]; all: Hex[]; total: number } | undefined {
  if (key === '') return undefined
  const held = latestContacts(key as Hex)
  if (held === undefined) return undefined
  const unique = [...new Set(parseContacts(held).map(contact => contact.pubkey))]
  return { authors: unique.slice(0, MAX_FOLLOWS), all: unique, total: unique.length }
}

export function useFollows(pubkey: Hex | undefined): FollowsResult {
  const key = pubkey ?? ''
  /** THE LIST WE ALREADY HAVE, available before the first byte of network traffic. */
  const query = useQuery({
    queryKey: ['follows', key],
    // A function, so it is re-run on later renders rather than frozen at mount.
    placeholderData: () => followsFrom(key),
    queryFn: async (): Promise<{ authors: Hex[]; all: Hex[]; total: number }> => {
      if (key === '') return { authors: [], all: [], total: 0 }
      // Fire-and-forget: the first fetch for a new account uses whatever is already known.
      const events = await getPool().query(
        [{ kinds: [KINDS.contacts], authors: [key], limit: 1 }],
        contactRelaysFor(key as Hex),
        QUERY_TIMEOUT_MS,
      )
      const answer = newest(events)
      /* The best of what came back AND of what we already knew. */
      const latest = answer === undefined ? latestContacts(key as Hex) : rememberContacts(answer)
      if (latest === undefined) return { authors: [], all: [], total: 0 }
      const all = parseContacts(latest).map(contact => contact.pubkey)
      // Deduped before counting: a contact list may name the same pubkey twice, and two.
      const unique = [...new Set(all)]
      return { authors: unique.slice(0, MAX_FOLLOWS), all: unique, total: unique.length }
    },
    enabled: key !== '',
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  return {
    authors: query.data?.authors ?? NO_AUTHORS,
    all: query.data?.all ?? NO_AUTHORS,
    total: query.data?.total ?? 0,
    loading: query.isPending && key !== '',
    resolved: query.isSuccess,
  }
}

/** Whether `pubkey` follows the reader. */
export function useFollowsYou(pubkey: Hex | undefined, viewer: Hex | undefined): boolean | undefined {
  const theirs = useFollows(pubkey)
  if (pubkey === undefined || viewer === undefined || pubkey === viewer) return undefined
  if (!theirs.resolved) return undefined
  // `authors` is capped for feed building.
  return theirs.total > 0 ? theirs.all.includes(viewer) : false
}
