import type { NostrEvent } from '@nostrich/nostr'

/** Stop one account from owning the timeline. */

/** One note per author per 30 minutes on a non-curated feed. */
const WINDOW_SECONDS = 30 * 60

export interface BurstOptions {
  /** Engagement score, when known. */
  score?: (event: NostrEvent) => number
  windowSeconds?: number
}

/** Collapse bursts, preserving the feed's existing order. */
export function collapseBursts(notes: NostrEvent[], options: BurstOptions = {}): NostrEvent[] {
  const windowSeconds = options.windowSeconds ?? WINDOW_SECONDS
  const score = options.score

  // author -> the note currently representing each window it has notes.
  const winners = new Map<string, Map<number, NostrEvent>>()

  for (const note of notes) {
    const bucket = Math.floor(note.created_at / windowSeconds)
    let byBucket = winners.get(note.pubkey)
    if (byBucket === undefined) {
      byBucket = new Map()
      winners.set(note.pubkey, byBucket)
    }
    const held = byBucket.get(bucket)
    if (held === undefined || beats(note, held, score)) byBucket.set(bucket, note)
  }

  const keep = new Set<string>()
  for (const byBucket of winners.values()) {
    for (const winner of byBucket.values()) keep.add(winner.id)
  }

  return notes.filter(note => keep.has(note.id))
}

function beats(candidate: NostrEvent, held: NostrEvent, score?: (e: NostrEvent) => number): boolean {
  if (score !== undefined) {
    const a = score(candidate)
    const b = score(held)
    if (a !== b) return a > b
  }
  return candidate.created_at > held.created_at
}

/** How many notes were dropped, per author, for the current view. */
export function burstCounts(before: NostrEvent[], after: NostrEvent[]): Map<string, number> {
  const kept = new Set(after.map(note => note.id))
  const counts = new Map<string, number>()
  for (const note of before) {
    if (kept.has(note.id)) continue
    counts.set(note.pubkey, (counts.get(note.pubkey) ?? 0) + 1)
  }
  return counts
}
