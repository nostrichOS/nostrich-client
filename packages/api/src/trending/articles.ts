/** The Articles chart: trending, built exactly like the notes chart, over a much. */

import {
  engagementScore,
  isExcludedFromTrending,
  parseProfile,
  type Hex,
  type NostrEvent,
  type Profile,
  type RelayUrl,
} from '@nostrich/nostr'

import { countInteractions } from './replies'
import { chunk, queryRelays } from './resolve'
import type { TrendingNote, TrendingPayload } from './build'

/** NIP-23 long-form. */
const ARTICLE_KIND = 30023

/** The window, in hours. */
export const ARTICLE_WINDOW_HOURS = 30 * 24

/** THE WINDOW IS ASKED FOR IN FIXED TIME SLICES, one at a time, newest first. */
const SLICE_SECONDS = 10 * 86_400
const SLICE_LIMIT = 500

/** Candidates per interaction filter. */
const IDS_PER_FILTER = 20

/** How long the chart. */
export const KEEP_ARTICLES = 150

/** How much of an article's body travels with the chart. */
const PREVIEW_CHARS = 400

/** The shortest thing that counts as an article. */
const MIN_CONTENT = 400

/** HOW FAST AN ARTICLE'S SCORE DECAYS WITH AGE. */
const GRAVITY = 0.5

/** The ranked value: engagement, aged. */
export function heat(score: number, ageSeconds: number): number {
  const hours = Math.max(0, ageSeconds) / 3_600
  return score / Math.pow(hours + 2, GRAVITY)
}

/** An article needs a name to be published under, and a face to publish. */
function named(profile: Profile | null): boolean {
  if (profile === null) return false
  if (typeof profile.name !== 'string' || profile.name.trim() === '') return false
  return typeof profile.picture === 'string' && profile.picture.trim() !== ''
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  const found = event.tags.find(tag => tag[0] === name)?.[1]
  return typeof found === 'string' && found.trim() !== '' ? found : undefined
}

/** `30023:<pubkey>:<d>`. */
export function addressOf(event: NostrEvent): string {
  return `${ARTICLE_KIND}:${event.pubkey}:${tagValue(event, 'd') ?? ''}`
}

/** One event per ADDRESS, newest wins. */
export function newestPerAddress(events: readonly NostrEvent[]): NostrEvent[] {
  const best = new Map<string, NostrEvent>()
  for (const event of events) {
    const key = addressOf(event)
    const held = best.get(key)
    if (held === undefined || event.created_at > held.created_at) best.set(key, event)
  }
  return [...best.values()]
}

/** Has a title and enough words under it to be worth ranking. */
export function readable(event: NostrEvent): boolean {
  return tagValue(event, 'title') !== undefined && event.content.trim().length >= MIN_CONTENT
}

export interface ArticleBuild {
  payload: TrendingPayload
  /** Candidates the relays offered, before any of the rules ran. */
  offered: number
}

/** Rank a set of counted articles. */
const PER_AUTHOR = 2

export function rankArticles(
  entries: readonly { event: NostrEvent; counts: TrendingNote['counts'] }[],
  keep = KEEP_ARTICLES,
  /** Now, in seconds. A parameter so the ordering can be tested without a clock. */
  at: number = Math.floor(Date.now() / 1_000),
): TrendingNote[] {
  const scored = entries
    .map(entry => ({ ...entry, score: engagementScore(entry.counts) }))
    /* TWO PEOPLE, OR ONE PAYMENT. Below that it is not a chart entry. */
    .filter(entry => {
      const { replies, reposts, reactions, zapCount } = entry.counts
      return zapCount >= 1 || replies + reposts + reactions >= 2
    })
    /* Ranked on the AGED score. */
    .sort(
      (a, b) =>
        heat(b.score, at - b.event.created_at) - heat(a.score, at - a.event.created_at) ||
        b.event.created_at - a.event.created_at,
    )

  const seen = new Map<string, number>()
  const out: TrendingNote[] = []
  for (const entry of scored) {
    if (out.length >= keep) break
    const already = seen.get(entry.event.pubkey) ?? 0
    if (already >= PER_AUTHOR) continue
    seen.set(entry.event.pubkey, already + 1)
    out.push({
      id: entry.event.id as Hex,
      pubkey: entry.event.pubkey as Hex,
      kind: entry.event.kind,
      createdAt: entry.event.created_at,
      content: entry.event.content.slice(0, PREVIEW_CHARS),
      // The reading time is a property of the whole piece, so it is counted before the trim.
      words: entry.event.content.trim().split(/\s+/).length,
      tags: entry.event.tags,
      counts: entry.counts,
      score: entry.score,
      sources: ['relays'],
    })
  }
  return out
}

/** Build the chart. */
export async function buildArticles(relays: readonly RelayUrl[]): Promise<ArticleBuild> {
  const since = Math.floor(Date.now() / 1000) - ARTICLE_WINDOW_HOURS * 3_600
  const now = Math.floor(Date.now() / 1_000)
  const slices: { since: number; until: number }[] = []
  for (let end = now; end > since; end -= SLICE_SECONDS) {
    slices.push({ since: Math.max(since, end - SLICE_SECONDS), until: end })
  }
  const raw = new Map<string, NostrEvent>()
  for (const slice of slices) {
    const page = await queryRelays(
      [{ kinds: [ARTICLE_KIND], since: slice.since, until: slice.until, limit: SLICE_LIMIT } as never],
      relays,
      20_000,
    )
    for (const event of page) raw.set(event.id, event)
  }

  /* The charts-only exclusion list applies HERE too. */
  const candidates = newestPerAddress([...raw.values()]).filter(
    event => readable(event) && !isExcludedFromTrending(event.pubkey as Hex),
  )
  const empty = { hours: ARTICLE_WINDOW_HOURS, builtAt: Date.now(), notes: [], profiles: [] }
  if (candidates.length === 0) return { payload: empty, offered: raw.size }

  /* The author's profile, which the payload needs anyway. */
  const authors = [...new Set(candidates.map(event => event.pubkey))] as Hex[]
  const profileEvents = (
    await Promise.all(
      chunk(authors, 20).map(batch => queryRelays([{ kinds: [0], authors: batch }], relays)),
    )
  ).flat()
  const newestProfile = new Map<Hex, NostrEvent>()
  for (const event of profileEvents) {
    const held = newestProfile.get(event.pubkey as Hex)
    if (held === undefined || event.created_at > held.created_at) {
      newestProfile.set(event.pubkey as Hex, event)
    }
  }

  // An author with no name is not publishing under one.
  const eligible = candidates.filter(event => {
    const kind0 = newestProfile.get(event.pubkey as Hex)
    return kind0 !== undefined && named(parseProfile(kind0))
  })

  /* ONE PASS OVER THE WHOLE WINDOW, not a series of batches. */
  const targets = eligible.map(event => ({ id: event.id as Hex, address: addressOf(event) }))
  const result = await countInteractions(targets, relays, IDS_PER_FILTER)
  const counted = new Map<Hex, TrendingNote['counts']>()
  for (const [id, verified] of result.kept) counted.set(id, { ...verified, zapSats: 0 })

  const notes = rankArticles(
    eligible.map(event => ({
      event,
      counts: counted.get(event.id as Hex) ?? { replies: 0, reposts: 0, quotes: 0, reactions: 0, zapCount: 0, zapSats: 0 },
    })),
  )

  const kept = new Set(notes.map(note => note.pubkey))
  return {
    payload: {
      hours: ARTICLE_WINDOW_HOURS,
      builtAt: Date.now(),
      notes,
      profiles: [...newestProfile.entries()]
        .filter(([pubkey]) => kept.has(pubkey))
        .map(([pubkey, event]) => ({ pubkey, profile: parseProfile(event) as Profile })),
    },
    offered: raw.size,
  }
}
