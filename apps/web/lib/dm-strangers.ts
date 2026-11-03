'use client'

import {
  conversationKeyOf,
  DEFAULT_INDEXER_RELAYS,
  DEFAULT_RELAYS,
  normalizeRelayUrls,
  type Hex,
  type RelayUrl,
} from '@nostrich/nostr'

import { isAccepted } from './chat-requests'
import { followsFrom } from './contacts'
import { getPool } from './pool'
import { knownDistance } from './social-graph'

/** Whether the reader follows this account or it is within two follows, from what is already held. */
export function knownTo(viewer: Hex): (sender: Hex) => boolean {
  const followed = new Set(followsFrom(viewer)?.all ?? [])
  return sender => followed.has(sender) || (knownDistance(viewer, sender) ?? Infinity) <= 2
}

/** Kind-4 messages from senders the reader knows, accepted, or has written to; unanswered means all. */
export async function legacyCorrespondents<E extends { id: string; pubkey: string; created_at: number }>(
  viewer: Hex,
  events: readonly E[],
  known: (sender: Hex) => boolean,
  relays: readonly RelayUrl[],
): Promise<E[]> {
  const vouched = (sender: string): boolean =>
    known(sender as Hex) || isAccepted(conversationKeyOf([viewer, sender as Hex]))
  const strangers = [...new Set(events.map(event => event.pubkey).filter(sender => sender !== viewer && !vouched(sender)))]
  if (strangers.length === 0) return [...events]
  let written = new Set<string>()
  try {
    const outcome = await getPool().queryWithStatus(
      [{ kinds: [4], authors: [viewer], '#p': strangers.slice(0, 200) }],
      relays.length > 0 ? [...relays] : undefined,
      6_000,
    )
    if (outcome.answered === 0) return [...events]
    written = new Set(outcome.events.flatMap(event => event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1] ?? '')))
  } catch {
    return [...events]
  }
  return events.filter(event => vouched(event.pubkey) || written.has(event.pubkey))
}

/** Which senders have no kind 0 on any relay asked; nobody answering means none are reported. */
export async function withoutProfile(senders: readonly Hex[], hasProfileHere: (pubkey: Hex) => boolean): Promise<Set<Hex>> {
  const asked = [...new Set(senders)].filter(pubkey => !hasProfileHere(pubkey)).slice(0, 200)
  if (asked.length === 0) return new Set()
  try {
    const outcome = await getPool().queryWithStatus(
      [{ kinds: [0], authors: asked }],
      normalizeRelayUrls([...getPool().readRelays(), ...DEFAULT_RELAYS, ...DEFAULT_INDEXER_RELAYS]),
      8_000,
    )
    if (outcome.answered === 0) return new Set()
    const found = new Set(outcome.events.map(event => event.pubkey))
    return new Set(asked.filter(pubkey => !found.has(pubkey)))
  } catch {
    return new Set()
  }
}

/** The kind-4 messages worth decrypting: everything but a stranger's with no profile anywhere. */
export async function legacyWorthOpening<E extends { id: string; pubkey: string; created_at: number }>(
  viewer: Hex,
  events: readonly E[],
  relays: readonly RelayUrl[],
  hasProfileHere: (pubkey: Hex) => boolean,
): Promise<E[]> {
  const theirs = events.filter(event => event.pubkey !== viewer)
  if (theirs.length === 0) return [...events]
  const vouched = new Set((await legacyCorrespondents(viewer, theirs, knownTo(viewer), relays)).map(event => event.id))
  const strangers = theirs.filter(event => !vouched.has(event.id)).map(event => event.pubkey as Hex)
  const nobody = await withoutProfile(strangers, hasProfileHere)
  return events.filter(event => !nobody.has(event.pubkey as Hex))
}
