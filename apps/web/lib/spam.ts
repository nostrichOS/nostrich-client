'use client'

import {
  MAX_HASHTAGS as SHAPE_MAX_HASHTAGS,
  SPAMMER_HASHTAGS as SHAPE_SPAMMER_HASHTAGS,
} from '@nostrich/nostr'
import { getTagValues, type Hex, type NostrEvent } from '@nostrich/nostr'
import {
  advertisesCampaignDomain,
  hasSuppressedName,
  isBlockedFromDiscovery,
  isSuppressed,
  isSuppressedName,
  linksToPhishingDomain,
} from '@nostrich/nostr'

import { readCachedProfile } from './profile-cache'

/** The PURE half of these rules now lives in the protocol core, so the TRENDING. */
export {
  advertisesCampaignDomain,
  bodySignature,
  hasAdultName,
  hasSuppressedName,
  isAdultName,
  isBlockedFromDiscovery,
  isExcludedFromTrending,
  isPromotable,
  isPromotableTag,
  isSuppressed,
  isSuppressedName,
  linksToPhishingDomain,
} from '@nostrich/nostr'

/** Tag-stuffing, and the accounts that do. */

/** Hashtags one note may carry and still be shown. */
export const MAX_HASHTAGS = SHAPE_MAX_HASHTAGS

/** Hashtags that condemn the account, not just the note. */
const SPAMMER_HASHTAGS = SHAPE_SPAMMER_HASHTAGS

const KEY = 'nostrich:tagspam:v1'

/** Bounded: this is a cache of a derivable fact, not a record worth growing forever. */
const MAX_REMEMBERED = 500

function load(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

let spammers = load()

function remember(pubkey: Hex): void {
  if (spammers.has(pubkey)) return
  spammers.add(pubkey)
  if (spammers.size > MAX_REMEMBERED) {
    // Oldest out.
    spammers = new Set([...spammers].slice(-MAX_REMEMBERED))
  }
  try {
    localStorage.setItem(KEY, JSON.stringify([...spammers]))
  } catch {
    // Private mode.
  }
}

/** Accounts the name rule has recognised in THIS session, learned from their own. */
const namedSpam = new Set<string>()

/** The name fields out of a kind-0 body, without importing anything that parses. */
function namesInProfileEvent(event: NostrEvent): string[] {
  try {
    const body = JSON.parse(event.content) as Record<string, unknown>
    return [body.display_name, body.displayName, body.name, body.nip05].filter(
      (value): value is string => typeof value === 'string',
    )
  } catch {
    // A kind-0 that is not JSON tells us nothing, which is not a reason to drop.
    return []
  }
}

export function rejectEvent(
  event: NostrEvent,
  verifiedNip05: (pubkey: Hex) => boolean = () => false,
  /** The author's profile, from cache, for the name rule. */
  profileOf: (pubkey: Hex) => { name?: string; displayName?: string; nip05?: string } | undefined =
    () => undefined,
): boolean {
  if (isSuppressed(event.pubkey)) return true
  if (namedSpam.has(event.pubkey)) return true

  // The profile event naming itself.
  if (event.kind === 0 && namesInProfileEvent(event).some(isSuppressedName)) {
    namedSpam.add(event.pubkey)
    return true
  }

  if (hasSuppressedName(profileOf(event.pubkey))) {
    namedSpam.add(event.pubkey)
    return true
  }
  if (!linksToPhishingDomain(event)) return false
  return !verifiedNip05(event.pubkey)
}

/** THE BROWSER HALF of the campaign-domain rule. */
export function isCampaignAccount(pubkey: Hex): boolean {
  return advertisesCampaignDomain(readCachedProfile(pubkey)?.profile)
}

/** Already caught tag-stuffing. Their notes are dropped whatever they carry now. */
export function isTagSpammer(pubkey: Hex): boolean {
  return spammers.has(pubkey)
}

/** Whether to drop this note, learning about its author on the way. */
export function isTagSpam(event: NostrEvent): boolean {
  // The hand-maintained list first: it is a Set lookup and it is the only rule.
  if (isBlockedFromDiscovery(event.pubkey)) return true
  /* The durable half of the same judgement. */
  if (isCampaignAccount(event.pubkey as Hex)) return true
  if (spammers.has(event.pubkey)) return true

  /** DISTINCT hashtags, lowercased. */
  const hashtags = new Set(
    getTagValues(event, 't').map(tag => tag.trim().toLowerCase()).filter(tag => tag !== ''),
  ).size
  if (hashtags >= SPAMMER_HASHTAGS) {
    // Everything they have posted and everything they post next.
    remember(event.pubkey)
    return true
  }
  return hashtags > MAX_HASHTAGS
}
