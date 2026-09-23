'use client'

import { useSyncExternalStore } from 'react'
import {
  authoredCounts,
  countsAreUsable,
  followingCount,
  getTagValues,
  isThinAccount,
  newestContacts,
  parseProfile,
  verifyNip05,
  type Hex,
  type NostrEvent,
} from '@nostrich/nostr'

import { latestContacts } from './contacts'
import { getPool } from './pool'
import { readCachedNip05, writeCachedNip05 } from './profile-cache'

/** ACCOUNTS TOO THIN TO PUT A MENTION IN SOMEBODY'S NOTIFICATIONS. */

/** Notes sampled per candidate. */
const SAMPLE = 100

/** Candidates per REQ, one filter. */
const FILTERS_PER_QUERY = 8

/** Candidates judged in one pass. */
const MAX_PER_PASS = 60

const TIMEOUT_MS = 6_000

const KEY = 'nostrich:thin-mentions:v1'

/** Verdicts kept. */
const MAX_REMEMBERED = 1_000

/** How long a verdict stands before the account is looked at again. */
const THIN_TTL_MS = 7 * 24 * 60 * 60_000
const OK_TTL_MS = 30 * 24 * 60 * 60_000

interface Verdict {
  /** True when the account failed the rule. */
  thin: boolean
  /** Epoch ms. */
  at: number
}

type Store = Record<string, Verdict>

/** A VERDICT IS ONLY VALID UNDER THE RULE THAT PRODUCED. */
const RULE_VERSION = 3

interface Stored {
  rule: number
  verdicts: Store
}

function load(): Store {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const held = parsed as Partial<Stored> & Store
    /* The unversioned shape is everything written before this existed. */
    if (typeof held.rule !== 'number' || held.rule !== RULE_VERSION) return {}
    const verdicts = held.verdicts
    if (typeof verdicts !== 'object' || verdicts === null || Array.isArray(verdicts)) return {}
    return verdicts
  } catch {
    return {}
  }
}

let store: Store = load()

/** Accounts already looked at THIS SESSION, whatever the answer. */
const attempted = new Set<string>()

let version = 0
const listeners = new Set<() => void>()

function bump(): void {
  version += 1
  for (const listener of listeners) listener()
}

function persist(): void {
  const keys = Object.keys(store)
  if (keys.length > MAX_REMEMBERED) {
    // Oldest verdicts out.
    const kept = keys
      .sort((a, b) => (store[b]?.at ?? 0) - (store[a]?.at ?? 0))
      .slice(0, MAX_REMEMBERED)
    const next: Store = {}
    for (const key of kept) {
      const held = store[key]
      if (held !== undefined) next[key] = held
    }
    store = next
  }
  try {
    // Stamped, so a later change to the rule can throw these away.
    localStorage.setItem(KEY, JSON.stringify({ rule: RULE_VERSION, verdicts: store } satisfies Stored))
  } catch {
    // Private mode or a full quota.
  }
}

function fresh(verdict: Verdict | undefined): Verdict | undefined {
  if (verdict === undefined) return undefined
  const ttl = verdict.thin ? THIN_TTL_MS : OK_TTL_MS
  return Date.now() - verdict.at < ttl ? verdict : undefined
}

/** The reader's own follows, memoised on the contact list that produced them. */
let followsFor: { id: string; set: ReadonlySet<string> } | undefined

function follows(viewer: Hex | undefined): ReadonlySet<string> {
  if (viewer === undefined) return new Set()
  const list = latestContacts(viewer)
  if (list === undefined) return new Set()
  if (followsFor?.id === list.id) return followsFor.set
  const set = new Set(getTagValues(list, 'p'))
  followsFor = { id: list.id, set }
  return set
}

/** Has this account been judged too thin to mention `viewer`. */
export function isThinMentioner(pubkey: Hex, viewer: Hex | undefined): boolean {
  if (pubkey === viewer) return false
  if (follows(viewer).has(pubkey)) return false
  return fresh(store[pubkey])?.thin === true
}

/** Bumped whenever a verdict lands, so the memos that filter notifications re-run. */
export function useThinMentionsVersion(): number {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
    () => 0,
  )
}

/** Candidates with no standing verdict, and not exempt on a fact we already hold. */
export function unjudged(pubkeys: readonly Hex[], viewer: Hex | undefined): Hex[] {
  const followed = follows(viewer)
  const out: Hex[] = []
  const seen = new Set<string>()
  for (const pubkey of pubkeys) {
    if (pubkey === viewer || followed.has(pubkey) || seen.has(pubkey)) continue
    if (attempted.has(pubkey) || fresh(store[pubkey]) !== undefined) continue
    seen.add(pubkey)
    out.push(pubkey)
  }
  return out
}

function record(pubkey: Hex, thin: boolean): void {
  store[pubkey] = { thin, at: Date.now() }
}

/** Whether a resolved NIP-05 claim vouches for this account. */
async function nip05Passes(pubkey: Hex, claim: string | undefined): Promise<boolean> {
  const trimmed = claim?.trim() ?? ''
  if (trimmed === '') return false
  const held = readCachedNip05(pubkey, trimmed)
  if (held !== undefined) return held.ok
  try {
    const status = await verifyNip05(trimmed, pubkey)
    writeCachedNip05(pubkey, trimmed, status.verified)
    return status.verified
  } catch {
    // Somebody's domain being unreachable is not evidence about them.
    writeCachedNip05(pubkey, trimmed, false)
    return false
  }
}

/** Judge `candidates`, writing a verdict. */
export async function judgeMentioners(
  candidates: readonly Hex[],
  viewer: Hex | undefined,
): Promise<void> {
  const todo = unjudged(candidates, viewer).slice(0, MAX_PER_PASS)
  if (todo.length === 0) return
  // Claimed up front, so a pass that ends up writing nothing cannot immediately.
  for (const pubkey of todo) attempted.add(pubkey)
  /* Counted per CALL, not in a module-level tally. */
  let decided = 0

  /* Fetched rather than read from the profile cache, and that is the point. */
  let metas: NostrEvent[]
  try {
    metas = await getPool().query([{ kinds: [0], authors: todo }] as never, undefined, TIMEOUT_MS)
  } catch {
    /* THE WHOLE PASS IS ABANDONED, not defaulted. */
    return
  }

  const newest = new Map<string, NostrEvent>()
  for (const meta of metas) {
    const held = newest.get(meta.pubkey)
    if (held === undefined || meta.created_at > held.created_at) newest.set(meta.pubkey, meta)
  }

  const counting: Hex[] = []
  for (const pubkey of todo) {
    const meta = newest.get(pubkey)
    const profile = meta === undefined ? undefined : parseProfile(meta)
    /* A PICTURE USED TO END IT HERE, and that was a second copy of the rule. */
    // eslint-disable-next-line no-await-in-loop -- one domain at a time, and almost never reached
    if (await nip05Passes(pubkey, profile?.nip05)) {
      record(pubkey, false)
      decided += 1
      continue
    }
    counting.push(pubkey)
  }

  for (let start = 0; start < counting.length; start += FILTERS_PER_QUERY) {
    const chunk = counting.slice(start, start + FILTERS_PER_QUERY)
    let notes: NostrEvent[]
    try {
      // eslint-disable-next-line no-await-in-loop -- chunks are sequential on purpose: this is
      // background work behind a drawn page and must not open eight subscriptions.
      notes = await getPool().query(
        chunk.map(pubkey => ({ kinds: [1], authors: [pubkey], limit: SAMPLE })) as never,
        undefined,
        TIMEOUT_MS,
      )
    } catch {
      // This chunk stays unjudged and its mentions stay visible.
      continue
    }

    /* CONTACT LISTS, in their own REQ rather than folded into the note filters above. */
    let contacts: Map<string, NostrEvent> | undefined
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential with the chunk above, and for the
      // Background work behind a drawn page opens one subscription at a time.
      const lists = await getPool().query(
        [{ kinds: [3], authors: chunk, limit: chunk.length * 2 }] as never,
        undefined,
        TIMEOUT_MS,
      )
      contacts = newestContacts(lists)
    } catch {
      contacts = undefined
    }

    for (const pubkey of chunk) {
      /* Counted and judged by the protocol core, so this and the PUSH WORKER cannot. */
      const counts = authoredCounts(notes, pubkey)
      if (!countsAreUsable(counts)) continue
      /* A MISSING LIST IS ZERO ONLY BECAUSE WE KNOW THE RELAYS ARE TALKING. */
      const following = contacts === undefined
        ? undefined
        : (followingCount(contacts.get(pubkey)) ?? 0)
      record(pubkey, isThinAccount({ hasPicture: false, nip05Verified: false, following, ...counts }))
      decided += 1
    }
  }

  if (decided === 0) return
  persist()
  // Only after something was actually decided.
  bump()
}

/** Test seam: drop every verdict. */
export function forgetThinMentions(): void {
  store = {}
  attempted.clear()
  followsFor = undefined
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to undo.
  }
  bump()
}
