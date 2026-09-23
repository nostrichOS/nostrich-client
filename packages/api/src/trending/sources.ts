/** The two indexes we ask what is trending, and what each of them actually gives back. */

import type { Hex, NostrEvent } from '@nostrich/nostr'

/** The three windows the panel offers. */
export const WINDOWS = [1, 4, 24] as const
export type Window = (typeof WINDOWS)[number]

/** Raw engagement counts as an index reports them, before our weighting. */
export interface SourceCounts {
  replies: number
  /** All amplifications, quotes included. */
  reposts: number
  /** The quote subset of `reposts`. */
  quotes: number
  reactions: number
  zapSats: number
  zapCount: number
}

export interface SourceNote {
  id: Hex
  counts: SourceCounts
  /** Present when the index shipped the note itself, rather than just its id. */
  event?: NostrEvent
}

export interface SourceResult {
  notes: SourceNote[]
  /** Author profiles the index volunteered, as kind-0 events. */
  profiles: NostrEvent[]
}

export const EMPTY_RESULT: SourceResult = { notes: [], profiles: [] }

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// ---------------------------------------------------------------------------.

/** Where candidates come. */
const INDEX_ENDPOINT = process.env['TRENDING_INDEX_URL'] ?? ''
/** Asked for in full because the rules below discard a good share. */
const INDEX_LIMIT = 200
/** Indexes rate-limit. */
export const WINE_SPACING_MS = 1_150

interface WineEntry {
  event_id?: unknown
  replies?: unknown
  reposts?: unknown
  reactions?: unknown
  zap_amount?: unknown
  zap_count?: unknown
}

export function parseWine(body: unknown): SourceNote[] {
  const rows: unknown = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data
  if (!Array.isArray(rows)) return []
  const out: SourceNote[] = []
  for (const row of rows as WineEntry[]) {
    const id = typeof row.event_id === 'string' ? row.event_id.toLowerCase() : undefined
    if (id === undefined || !/^[0-9a-f]{64}$/.test(id)) continue
    out.push({
      id: id as Hex,
      counts: {
        replies: num(row.replies),
        reposts: num(row.reposts),
        quotes: 0,
        reactions: num(row.reactions),
        zapSats: num(row.zap_amount),
        zapCount: num(row.zap_count),
      },
    })
  }
  return out
}

export async function fetchWine(hours: Window, timeoutMs: number): Promise<SourceResult> {
  if (INDEX_ENDPOINT === '') throw new Error('TRENDING_INDEX_URL is not set')
  const url = `${INDEX_ENDPOINT}?hours=${hours}&limit=${INDEX_LIMIT}`
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`the index answered ${response.status}`)
  return { notes: parseWine(await response.json()), profiles: [] }
}
