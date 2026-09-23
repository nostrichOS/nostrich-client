import { getTagValues } from './events'
import type { NostrEvent } from './types'

/** ACCOUNTS TOO THIN TO PUT A MENTION IN FRONT OF SOMEBODY. */

/** Root notes an author must EXCEED to reach a stranger. */
export const MIN_ROOT_NOTES = 10

/** Replies an author must EXCEED, counted separately. */
export const MIN_REPLIES = 10

/** Accounts they must follow MORE than, matching the shape of the two above. */
export const MIN_FOLLOWING = 10

export interface AccountEvidence {
  /** A non-empty `picture` on their kind-0. Still gathered, and no longer an exemption. */
  hasPicture: boolean
  /** A `nip05` that RESOLVED back to this pubkey. */
  nip05Verified: boolean
  rootNotes: number
  replies: number
  /** Accounts they follow. */
  following?: number | undefined
}

/** Whether this account is too thin to mention a stranger. */
export function isThinAccount(evidence: AccountEvidence): boolean {
  /* A PICTURE IS NOT EVIDENCE OF ANYTHING, and it used to spare an account outright. */
  if (evidence.nip05Verified) return false
  if (evidence.rootNotes <= MIN_ROOT_NOTES || evidence.replies <= MIN_REPLIES) return true
  /* FOLLOWING NOBODY, from an account with a real posting history. */
  return evidence.following !== undefined && evidence.following <= MIN_FOLLOWING
}

/** Distinct accounts a contact list follows, or `undefined` when there is no list. */
export function followingCount(contacts: NostrEvent | undefined): number | undefined {
  if (contacts === undefined) return undefined
  return new Set(getTagValues(contacts, 'p')).size
}

/** The newest kind-3 per author from a batch answer. */
export function newestContacts(events: readonly NostrEvent[]): Map<string, NostrEvent> {
  const out = new Map<string, NostrEvent>()
  for (const event of events) {
    if (event.kind !== 3) continue
    const held = out.get(event.pubkey)
    if (held === undefined || event.created_at > held.created_at) out.set(event.pubkey, event)
  }
  return out
}

export interface AuthoredCounts {
  rootNotes: number
  replies: number
}

/** Root notes and replies among `events`, for one author. */
export function authoredCounts(
  events: readonly NostrEvent[],
  pubkey: string,
): AuthoredCounts {
  const seen = new Set<string>()
  let rootNotes = 0
  let replies = 0
  for (const event of events) {
    if (event.pubkey !== pubkey || seen.has(event.id)) continue
    seen.add(event.id)
    if (getTagValues(event, 'e').length === 0) rootNotes += 1
    else replies += 1
  }
  return { rootNotes, replies }
}

/** Whether the counts can be trusted at all. */
export function countsAreUsable(counts: AuthoredCounts): boolean {
  return counts.rootNotes + counts.replies > 0
}
