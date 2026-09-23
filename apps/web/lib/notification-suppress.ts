import { KINDS, MAX_ROOT_PTAGS, NUTZAP_KIND, parseReaction, type Hex, type NostrEvent } from '@nostrich/nostr'

import { isDeleted } from './deleted'
import { isBlockedFromDiscovery, isCampaignAccount, isTagSpam } from './spam'
import { isMutedContent } from './muted-content'
import { isMuted } from './user-lists'

/** EVERY SUPPRESSION RULE THE NOTIFICATIONS SURFACE APPLIES, IN ONE PLACE. */

const MAX_MENTION_PTAGS = MAX_ROOT_PTAGS
const ZAP_RECEIPT = 9735

function firstETag(event: NostrEvent): Hex | undefined {
  for (const tag of event.tags) {
    if (tag[0] === 'e' && tag[1] !== undefined) return tag[1]
  }
  return undefined
}

/** The note a `q` tag points. */
function firstQTag(event: NostrEvent): Hex | undefined {
  for (const tag of event.tags) {
    if (tag[0] === 'q' && tag[1] !== undefined && tag[1].length === 64) return tag[1] as Hex
  }
  return undefined
}

/** The note a notification. */
export function notificationTarget(event: NostrEvent): Hex | undefined {
  const reaction = event.kind === KINDS.reaction ? parseReaction(event) : undefined
  return reaction?.targetId ?? firstETag(event) ?? firstQTag(event)
}

/** A LIKE OF A LIKE IS NOT NEWS. */
export function reactsToOwnReaction(
  event: NostrEvent,
  myReactions: ReadonlySet<string>,
): boolean {
  if (event.kind !== KINDS.reaction || myReactions.size === 0) return false
  const target = notificationTarget(event)
  return target !== undefined && myReactions.has(target)
}

/** Should this event reach the reader at all. */
export function suppressed(event: NostrEvent): boolean {
  /** Two kinds are exempt from the broadcast cap, for opposite reasons. */
  const broadcastable =
    event.kind !== ZAP_RECEIPT && event.kind !== NUTZAP_KIND && event.kind !== KINDS.contacts
  if (broadcastable) {
    if (event.tags.filter(tag => tag[0] === 'p').length > MAX_MENTION_PTAGS) return true
    // A muted account must not be able to reach you by replying, reacting or tagging.
    if (isMutedContent(event)) return true
    if (isTagSpam(event)) return true
    /** The hand-maintained list. */
    if (isBlockedFromDiscovery(event.pubkey)) return true
  }

  /** Nothing about a note the reader deleted. */
  const target = notificationTarget(event)
  if (target !== undefined && isDeleted(target)) return true

  return false
}

/** May this ACCOUNT's actions be announced to the reader at all. */
export function announceableActor(pubkey: Hex): boolean {
  // `isCampaignAccount` beside the blocklist rather than folded into it: the two answer.
  return !isMuted(pubkey) && !isBlockedFromDiscovery(pubkey) && !isCampaignAccount(pubkey)
}

/** Who saved the note, read back out of a bookmark key. */
export function bookmarkActor(key: string): Hex {
  return key.slice(0, key.indexOf(':')) as Hex
}
