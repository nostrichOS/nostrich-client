'use client'

import {
  MAX_ROOT_PTAGS,
  getTagValues,
  powBits,
  type Hex,
  type NostrEvent,
  type Profile,
} from '@nostrich/nostr'

import { selfPromotingReply } from '@nostrich/nostr'

import { mutedFor, muteReason } from './muted-content'
import { readCachedProfile } from './profile-cache'
import { isBlockedFromDiscovery, isTagSpammer, MAX_HASHTAGS } from './spam'
import { isMuted } from './user-lists'

/** How much standing an account has, and what a surface may do. */

export type Tier =
  /** The reader's own instruction. */
  | 'muted'
  /** The reader. Never judged. */
  | 'self'
  /** Distance 0-1. */
  | 'trusted'
  /** Distance 2. */
  | 'known'
  /** Outside the graph, but carrying independent evidence of being a real account. */
  | 'vouched'
  /** Has a profile with a usable name, and nothing else is known. */
  | 'unknown'
  /** Positive evidence of abuse. */
  | 'suspect'

export type Action = 'show' | 'rank-down' | 'collapse' | 'hide'

export type ReasonCode =
  | 'muted'
  | 'blocked'
  | 'no-profile'
  | 'tag-spammer'
  | 'tag-stuffing'
  | 'hellthread'
  | 'advertising-reply'
  | 'filtered'
  | 'outside-graph'

export interface Reason {
  code: ReasonCode
  /** One sentence, in the reader's terms. */
  text: string
}

export interface Verdict {
  tier: Tier
  action: Action
  reasons: Reason[]
}

/** What a surface is allowed to do, which is a property of the SURFACE. */
export type Surface = 'curated' | 'discovery'

export interface TrustContext {
  /** The reader, when signed. */
  viewer?: Hex
  /** Whether the follow graph has finished crawling. */
  graphReady: boolean
  /** Follow distance: 0 self, 1 follows, 2 follows-of-follows, Infinity outside. */
  distance: (pubkey: Hex) => number
  /** The author's profile, if one is already known. */
  profileFor: (pubkey: Hex) => Profile | undefined
  /** Whether the author's NIP-05 claim has been checked and resolved back to them. */
  nip05Verified: (pubkey: Hex) => boolean
}

/** Hashtags that mark a note rather than an account. */
export { MAX_HASHTAGS }

/** Mentions in a ROOT note past which it is a broadcast, not a post. */
export { MAX_ROOT_PTAGS }

/** NIP-13 proof-of-work that counts as evidence. */
export const POW_BITS = 20

/** How old a profile must be to count as evidence of an established account. */
const ESTABLISHED_MS = 30 * 24 * 60 * 60_000

function isEstablished(profile: Profile | undefined): boolean {
  if (profile === undefined) return false
  /** Zero is UNKNOWN, not 1970. `readCachedProfile` deliberately returns `updatedAt: 0`. */
  if (profile.updatedAt <= 0) return false
  return Date.now() - profile.updatedAt * 1000 > ESTABLISHED_MS
}

function hasUsableName(profile: Profile | undefined): boolean {
  if (profile === undefined) return false
  return (profile.displayName ?? '').trim() !== '' || (profile.name ?? '').trim() !== ''
}

/** A profile somebody actually filled. */
function isComplete(profile: Profile | undefined): boolean {
  if (profile === undefined) return false
  const hasBio = (profile.about ?? '').trim() !== ''
  const hasPicture = (profile.picture ?? '').trim() !== ''
  return hasBio && hasPicture
}

function distinctHashtags(event: NostrEvent): number {
  return new Set(
    getTagValues(event, 't')
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag !== ''),
  ).size
}

/** How much standing this account has with this reader. */
export function authorTier(pubkey: Hex, context: TrustContext): Tier {
  /** SELF BEFORE MUTED, and the order is the whole point. */
  if (context.viewer !== undefined && pubkey === context.viewer) return 'self'
  if (isMuted(pubkey)) return 'muted'

  // Distance rules, and ONLY when the graph can actually answer.
  if (context.graphReady) {
    const distance = context.distance(pubkey)
    if (distance <= 1) return 'trusted'
    if (distance === 2) return 'known'
  }

  // ── The five rules allowed to demote ──────────────────────────────────────────────.
  if (isBlockedFromDiscovery(pubkey)) return 'suspect'
  const profile = context.profileFor(pubkey)
  if (!hasUsableName(profile)) return 'suspect'
  if (isTagSpammer(pubkey)) return 'suspect'

  // ── Promotions ────────────────────────────────────────────────────────────────────.
  if (context.nip05Verified(pubkey) && (isComplete(profile) || isEstablished(profile))) {
    return 'vouched'
  }

  return 'unknown'
}

/** Why this author sits below `unknown`, in the reader's words. */
export function authorReasons(pubkey: Hex, context: TrustContext): Reason[] {
  if (isMuted(pubkey)) return [{ code: 'muted', text: 'You muted this account.' }]
  if (isBlockedFromDiscovery(pubkey)) {
    return [{ code: 'blocked', text: 'This account is on the spam list.' }]
  }
  if (!hasUsableName(context.profileFor(pubkey))) {
    return [{ code: 'no-profile', text: 'This account has no profile.' }]
  }
  if (isTagSpammer(pubkey)) {
    return [{ code: 'tag-spammer', text: 'This account posts notes stuffed with hashtags.' }]
  }
  return []
}

/** What is wrong with this NOTE, regardless of who wrote. */
/** A REPLY THAT LINKS TO THE AUTHOR'S OWN ADVERTISED SITE. */
export function advertisingReply(event: NostrEvent): boolean {
  return selfPromotingReply(event, readCachedProfile(event.pubkey as Hex)?.hosts ?? [])
}

export function noteReasons(event: NostrEvent): Reason[] {
  const reasons: Reason[] = []

  if (advertisingReply(event)) {
    // Said as an observation, not an accusation.
    reasons.push({
      code: 'advertising-reply',
      text: 'This reply links to the site in its author\u2019s own profile.',
    })
  }

  const hashtags = distinctHashtags(event)
  if (hashtags > MAX_HASHTAGS) {
    reasons.push({ code: 'tag-stuffing', text: `This note carries ${hashtags} hashtags.` })
  }

  /** Only ROOT notes. */
  const isRoot = getTagValues(event, 'e').length === 0
  const mentions = new Set(getTagValues(event, 'p')).size
  if (isRoot && mentions >= MAX_ROOT_PTAGS) {
    reasons.push({ code: 'hellthread', text: `This note tags ${mentions} accounts.` })
  }

  return reasons
}

/** The whole judgement: who wrote it, what it is, and what this surface may do. */
export function verdictFor(event: NostrEvent, context: TrustContext, surface: Surface): Verdict {
  const tier = authorTier(event.pubkey, context)

  /** YOUR OWN NOTE IS NEVER FILTERED BY YOUR OWN FILTERS. */
  if (tier === 'self') return { tier, action: 'show', reasons: [] }

  const reasons = [...authorReasons(event.pubkey, context), ...noteReasons(event)]

  // Mute is the one filter that crosses onto a curated surface.
  if (tier === 'muted') return { tier, action: 'hide', reasons }

  /** The reader's OWN content filters. */
  const filtered = mutedFor(event)
  if (filtered !== undefined) {
    return { tier, action: 'collapse', reasons: [{ code: 'filtered', text: muteReason(filtered) }] }
  }

  /** Nothing else may touch a surface the reader curated. */
  if (surface === 'curated') return { tier, action: 'show', reasons: [] }

  // Never actionable, whatever else is true.
  if (tier === 'trusted') return { tier, action: 'show', reasons: [] }

  if (tier === 'suspect') return { tier, action: 'collapse', reasons }
  if (reasons.length > 0) return { tier, action: 'collapse', reasons }

  /** Work done on the note itself, which is evidence about the NOTE rather. */
  if (powBits(event.id) >= POW_BITS) return { tier, action: 'show', reasons: [] }

  // Outside the graph with no evidence either way: shown, but it does not get to lead.
  if (tier === 'unknown' && context.graphReady) {
    return {
      tier,
      action: 'rank-down',
      reasons: [{ code: 'outside-graph', text: 'Nobody you follow follows this account.' }],
    }
  }

  return { tier, action: 'show', reasons: [] }
}

/** Ordering weight, lower is better. */
export function tierRank(tier: Tier): number {
  switch (tier) {
    case 'self':
      return 0
    case 'trusted':
      return 1
    case 'known':
      return 2
    case 'vouched':
      return 3
    case 'unknown':
      return 4
    case 'suspect':
      return 5
    case 'muted':
      return 6
  }
}
