import { getTagValues, getTags } from './events'
import type { Hex, NostrEvent } from './types'

/** NIP-53 LIVE EVENTS. */

/** NIP-53 live event. */
export const LIVE_EVENT_KIND = 30311

/** The three states NIP-53 defines, plus our reading of a missing one. */
export type LiveStatus = 'planned' | 'live' | 'ended' | 'unknown'

export interface LiveEvent {
  identifier: string
  title: string | undefined
  summary: string | undefined
  image: string | undefined
  status: LiveStatus
  /** Unix seconds, when the host wrote them. */
  starts: number | undefined
  ends: number | undefined
  /** Watching right now, per the host. */
  currentParticipants: number | undefined
  totalParticipants: number | undefined
  /** Whoever the event names as Host, falling back to the event's author. */
  host: Hex
  /** A player the host advertises. */
  streaming: string | undefined
  recording: string | undefined
}

function firstTag(event: NostrEvent, name: string): string | undefined {
  const value = getTagValues(event, name)[0]?.trim()
  return value === undefined || value === '' ? undefined : value
}

/** A tag whose value must be a non-negative integer. */
function count(event: NostrEvent, name: string): number | undefined {
  const raw = firstTag(event, name)
  if (raw === undefined) return undefined
  if (!/^\d+$/.test(raw)) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) ? value : undefined
}

function seconds(event: NostrEvent, name: string): number | undefined {
  const value = count(event, name)
  // A zero timestamp is 1970 and means the tag was written empty.
  return value === undefined || value === 0 ? undefined : value
}

function statusOf(event: NostrEvent): LiveStatus {
  switch (firstTag(event, 'status')?.toLowerCase()) {
    case 'live':
      return 'live'
    case 'ended':
      return 'ended'
    case 'planned':
      return 'planned'
    default:
      return 'unknown'
  }
}

/** The host, read from the `p` tag NIP-53 marks with the role `Host`. */
function hostOf(event: NostrEvent): Hex {
  for (const tag of getTags(event, 'p')) {
    const pubkey = tag[1]
    if (pubkey === undefined || pubkey.length !== 64) continue
    if ((tag[3] ?? '').trim().toLowerCase() === 'host') return pubkey as Hex
  }
  return event.pubkey as Hex
}

/** Whether this event is a live stream at all. */
export function isLiveEvent(event: NostrEvent): boolean {
  return event.kind === LIVE_EVENT_KIND
}

export function parseLiveEvent(event: NostrEvent): LiveEvent {
  return {
    identifier: firstTag(event, 'd') ?? '',
    title: firstTag(event, 'title'),
    summary: firstTag(event, 'summary'),
    image: firstTag(event, 'image'),
    status: statusOf(event),
    starts: seconds(event, 'starts'),
    ends: seconds(event, 'ends'),
    currentParticipants: count(event, 'current_participants'),
    totalParticipants: count(event, 'total_participants'),
    host: hostOf(event),
    streaming: firstTag(event, 'streaming'),
    recording: firstTag(event, 'recording'),
  }
}

/** The moment a card should date the stream. */
export function liveEventAt(live: LiveEvent, event: NostrEvent): number {
  if (live.status === 'ended') return live.ends ?? live.starts ?? event.created_at
  return live.starts ?? live.ends ?? event.created_at
}
