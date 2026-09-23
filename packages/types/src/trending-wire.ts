/** `/api/trending`'s payload, and the one place it becomes Nostr events. */

import { KINDS, type Hex, type NostrEvent } from '@nostrich/nostr'

/** One row. Mirrors `TrendingNote` in `packages/api/src/trending/build.ts`. */
export interface ServedNote {
  id: Hex
  pubkey: Hex
  /** Optional only for a snapshot built before the field existed. */
  kind?: number
  /** Words in the FULL body, when `content` is a preview. */
  words?: number
  createdAt: number
  content: string
  tags: string[][]
  counts?: {
    replies: number
    /** All amplifications, quotes included. */
    reposts: number
    /** The quote subset of `reposts`, earning the score's ×1 top-up. */
    quotes: number
    reactions: number
    zapSats: number
    zapCount: number
  }
}

export interface ServedProfile {
  pubkey: Hex
  profile: {
    name?: string
    displayName?: string
    display_name?: string
    picture?: string
    about?: string
    nip05?: string
    lud16?: string
    lud06?: string
  }
}

export interface TrendingPayload {
  hours: number
  /** False in the minutes after a fresh deploy, before the worker's first build. */
  ready: boolean
  notes: ServedNote[]
  profiles: ServedProfile[]
  /** Seconds since the snapshot was built. */
  ageSeconds?: number
}

/** The wire row as a Nostr event. */
export function toEvent(note: ServedNote): NostrEvent {
  return {
    id: note.id,
    pubkey: note.pubkey,
    kind: note.kind ?? KINDS.shortNote,
    created_at: note.createdAt,
    content: note.content,
    tags: note.tags,
    sig: '',
  }
}

/** True when the row is a whole note rather than a truncated article preview. */
export function isWholeNote(note: ServedNote): boolean {
  return (note.kind ?? KINDS.shortNote) === KINDS.shortNote
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Read the response, trusting nothing. */
export function parseTrendingPayload(value: unknown, hours: number): TrendingPayload {
  const empty: TrendingPayload = { hours, ready: false, notes: [], profiles: [] }
  if (typeof value !== 'object' || value === null) return empty
  const body = value as Record<string, unknown>

  const notes: ServedNote[] = []
  for (const raw of Array.isArray(body['notes']) ? body['notes'] : []) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as Record<string, unknown>
    const id = row['id']
    const pubkey = row['pubkey']
    if (typeof id !== 'string' || typeof pubkey !== 'string') continue
    const counts = row['counts']
    notes.push({
      id,
      pubkey,
      ...(typeof row['kind'] === 'number' ? { kind: row['kind'] } : {}),
      ...(typeof row['words'] === 'number' ? { words: row['words'] } : {}),
      createdAt: num(row['createdAt']),
      content: typeof row['content'] === 'string' ? row['content'] : '',
      tags: Array.isArray(row['tags']) ? (row['tags'] as string[][]) : [],
      ...(typeof counts === 'object' && counts !== null
        ? {
            counts: {
              replies: num((counts as Record<string, unknown>)['replies']),
              reposts: num((counts as Record<string, unknown>)['reposts']),
              // Absent on snapshots built before quotes were split out.
              quotes: num((counts as Record<string, unknown>)['quotes']),
              reactions: num((counts as Record<string, unknown>)['reactions']),
              zapSats: num((counts as Record<string, unknown>)['zapSats']),
              zapCount: num((counts as Record<string, unknown>)['zapCount']),
            },
          }
        : {}),
    })
  }

  const profiles: ServedProfile[] = []
  for (const raw of Array.isArray(body['profiles']) ? body['profiles'] : []) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as Record<string, unknown>
    const pubkey = row['pubkey']
    const profile = row['profile']
    if (typeof pubkey !== 'string' || typeof profile !== 'object' || profile === null) continue
    profiles.push({ pubkey, profile: profile as ServedProfile['profile'] })
  }

  return {
    hours,
    ready: body['ready'] === true,
    notes,
    profiles,
    ...(typeof body['ageSeconds'] === 'number' ? { ageSeconds: body['ageSeconds'] } : {}),
  }
}
