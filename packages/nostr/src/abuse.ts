import { hostOf } from './hosts'

/** WHETHER A NOTE'S ENGAGEMENT IS REAL. */

/** What every rule reads. */
/** WHAT A SURFACE HAPPENS TO KNOW about a note's engagement. */
export interface ObservedCounts {
  replies?: number
  likes?: number
  reposts?: number
  zapSats?: number
}

/** Named so a caller can treat kinds differently and a log can say which fired. */
export type Manipulation = 'replies-only' | 'new-account-replies' | 'reactions-only'

/** A REPLY THAT LINKS TO THE AUTHOR'S OWN SITE is advertising, not conversation. */
export function selfPromotingReply(
  event: { tags: readonly (readonly string[])[]; content: string },
  /** Everything this author advertises. */
  hosts: readonly string[],
): boolean {
  if (hosts.length === 0) return false
  // A reply, not a root note.
  if (!event.tags.some(tag => tag[0] === 'e')) return false
  for (const match of event.content.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const host = hostOf(match[0])
    if (host !== undefined && hosts.includes(host)) return true
  }
  return false
}

/** EVERY DOMAIN AN ACCOUNT ADVERTISES ON ITS OWN PROFILE. */
export function advertisedHosts(
  profile: { website?: string | undefined; about?: string | undefined } | null | undefined,
): string[] {
  if (profile === null || profile === undefined) return []
  const hosts = new Set<string>()
  const site = hostOf(profile.website)
  if (site !== undefined) hosts.add(site)
  for (const match of (profile.about ?? '').matchAll(/(?:[a-z0-9-]+\.)+[a-z]{2,24}/gi)) {
    hosts.add(match[0].replace(/^www\./i, '').toLowerCase())
  }
  return [...hosts]
}

/** Replies with nothing else. */
const REPLY_FARM_FLOOR = 5

function repliesOnly(counts: ObservedCounts): boolean {
  if ((counts.replies ?? 0) < REPLY_FARM_FLOOR) return false
  return (counts.likes ?? 0) === 0 && (counts.reposts ?? 0) === 0 && (counts.zapSats ?? 0) === 0
}

/** A PILE OF REACTIONS AND NOTHING ELSE is the mirror of `repliesOnly`, for the mirror. */
const REACTION_FLOOD_FLOOR = 10

function reactionsOnly(counts: ObservedCounts): boolean {
  if ((counts.likes ?? 0) < REACTION_FLOOD_FLOOR) return false
  return (counts.replies ?? 0) === 0 && (counts.reposts ?? 0) === 0 && (counts.zapSats ?? 0) === 0
}

/** Replies written almost entirely by accounts too new to have a history. */
const NEW_ACCOUNT_SHARE = 0.8

function newAccountReplies(
  replyAuthors: readonly string[],
  established: (pubkey: string) => boolean,
): boolean {
  if (replyAuthors.length < REPLY_FARM_FLOOR) return false
  const strangers = replyAuthors.filter(pubkey => !established(pubkey)).length
  return strangers / replyAuthors.length >= NEW_ACCOUNT_SHARE
}

/** The reason this note's numbers look bought, or undefined when they look earned. */
export function manipulatedEngagement(
  counts: ObservedCounts | undefined,
  /** Who replied, and whether each looks like a real account. */
  repliers?: { authors: readonly string[]; established: (pubkey: string) => boolean },
): Manipulation | undefined {
  if (counts === undefined) return undefined
  if (repliesOnly(counts)) return 'replies-only'
  if (reactionsOnly(counts)) return 'reactions-only'
  if (repliers !== undefined && newAccountReplies(repliers.authors, repliers.established)) {
    return 'new-account-replies'
  }
  return undefined
}
