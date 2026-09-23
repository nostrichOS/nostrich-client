import { KINDS, type NostrEvent } from '@nostrich/nostr'
import { verifyEvent } from '@nostrich/nostr'
import { rememberEvent } from './event-cache'

/** The note a repost carries. */
/** Ids whose embedded copy has already passed full verification this session. */
const verifiedEmbeds = new Set<string>()

export function repostedEvent(event: NostrEvent): NostrEvent | undefined {
  if (event.kind !== KINDS.repost && event.kind !== GENERIC_REPOST) return undefined
  const raw = event.content.trim()
  if (raw === '' || !raw.startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isEvent(parsed)) return undefined
    /* The card renders the embedded copy either way. */
    if (!verifiedEmbeds.has(parsed.id)) {
      if (verifyEvent(parsed)) {
        verifiedEmbeds.add(parsed.id)
        rememberEvent(parsed)
      }
    }
    return parsed
  } catch {
    // A repost whose content is not JSON is not broken, it is one of the many that carry.
    return undefined
  }
}

/** NIP-18's kind-16, for reposting something that is not a kind-1. Same envelope, same. */
const GENERIC_REPOST = 16

function isEvent(value: unknown): value is NostrEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.id) &&
    typeof candidate.pubkey === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.pubkey) &&
    typeof candidate.kind === 'number' &&
    typeof candidate.content === 'string' &&
    typeof candidate.created_at === 'number' &&
    Array.isArray(candidate.tags)
  )
}

/** The note to show for this event: the one inside a repost, or the event itself. */
export function unwrapRepost(event: NostrEvent): NostrEvent
export function unwrapRepost(event: NostrEvent | undefined): NostrEvent | undefined
export function unwrapRepost(event: NostrEvent | undefined): NostrEvent | undefined {
  if (event === undefined) return undefined
  return repostedEvent(event) ?? event
}
