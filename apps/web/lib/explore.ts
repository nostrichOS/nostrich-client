'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KINDS, isReply, type Hex, type NostrEvent } from '@nostrich/nostr'

import { isMutedContent } from './muted-content'
import { rememberEvents } from './event-cache'
import {
  isBlockedFromDiscovery,
  isCampaignAccount,
  isPromotable,
  isPromotableTag,
  isTagSpam,
} from './spam'
import { isMuted } from './user-lists'
import { getPool } from './pool'
import { useTrending } from './trending'

/** The data behind Explore. */

/** One window for the whole page. */
export const EXPLORE_HOURS = 24

/** Notes pulled per window. */
const NOTE_TIMEOUT_MS = 9_000

export interface ExploreData {
  notes: NostrEvent[]
  /** Engagement score per note id, from the index rather than counted locally. */
  scores: Map<string, number>
  loading: boolean
  error: string | null
}

/** Shared instance, so an empty result keeps a stable identity between renders. */
const NO_NOTES: NostrEvent[] = []

export function useExploreData(enabled: boolean): ExploreData {
  const trending = useTrending(EXPLORE_HOURS, enabled)

  const ids = useMemo(() => trending.entries.map(entry => entry.id), [trending.entries])
  const scores = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of trending.entries) map.set(entry.id, entry.score)
    return map
  }, [trending.entries])

  // Keyed by the ids themselves rather than by the window: while the index returns.
  const key = ids.join(',')

  const query = useQuery({
    queryKey: ['explore-notes', key],
    queryFn: async (): Promise<NostrEvent[]> => {
      const events = await getPool().query([{ ids: [...ids] }], undefined, NOTE_TIMEOUT_MS)
      // Opening one of these should not re-query.
      rememberEvents(events)
      /** Replies are half a conversation out of context, and a reply that trended is usually. */
      return events.filter(
        event =>
          event.kind === KINDS.shortNote &&
          !isReply(event) &&
          !isMutedContent(event) &&
          !isTagSpam(event) &&
          // Explore is a surface we compose, so the same rule that keeps adult tags out.
          isPromotable(event),
      )
    },
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
  })

  return {
    notes: query.data ?? NO_NOTES,
    scores,
    // Pending only on a first load for this id set.
    loading: (query.isPending && enabled && ids.length > 0) || trending.loading,
    error: trending.error,
  }
}

// ---------------------------------------------------------------------------.

export interface Topic {
  tag: string
  /** Notes carrying the tag in the window, counted by asking the relays for THAT TAG. */
  notes: number
  /** True when `notes` hit the per-tag query cap, so it is a floor rather than a total. */
  atLeast: boolean
  /** Distinct accounts using the tag. */
  score: number
}

// ---------------------------------------------------------------------------.

export interface TrendingPerson {
  pubkey: Hex
  /** Summed engagement across every trending note of theirs. */
  score: number
  notes: number
  /** Their best-performing note, for a one-line preview. */
  top: NostrEvent
}

/** Authors of trending notes, ranked by their total engagement in the window. */
export function peopleFrom(
  events: readonly NostrEvent[],
  scores: ReadonlyMap<string, number>,
  max: number,
): TrendingPerson[] {
  const byAuthor = new Map<Hex, { score: number; notes: number; top: NostrEvent; topScore: number }>()
  for (const event of events) {
    /** Asked again here, on purpose, even though the caller already filtered these events. */
    // This function recommends the ACCOUNT, which is precisely the outcome the campaign.
    if (isBlockedFromDiscovery(event.pubkey) || isCampaignAccount(event.pubkey as Hex)) continue
    const score = scores.get(event.id) ?? 0
    const current = byAuthor.get(event.pubkey)
    if (current === undefined) {
      byAuthor.set(event.pubkey, { score, notes: 1, top: event, topScore: score })
      continue
    }
    current.score += score
    current.notes += 1
    if (score > current.topScore) {
      current.top = event
      current.topScore = score
    }
  }
  return [...byAuthor.entries()]
    .map(([pubkey, v]) => ({ pubkey, score: v.score, notes: v.notes, top: v.top }))
    .sort((a, b) => b.score - a.score || b.notes - a.notes)
    .slice(0, max)
}

// --------------------------------------------------------------------------- Topics.

/** Notes sampled to count hashtags, per relay. */
/** Relays asked for the nomination sample. */
const SAMPLE_RELAYS = 3

/** Notes drawn to NOMINATE tags, down from 1,000. Every one of them. */
const TOPIC_SAMPLE = 1_000

/** Tags taken from the sample and then counted for real. */
/** Candidates counted, down from 120. The sample ORDERS candidates by how often. */
const TAG_CANDIDATES = 80

/** COUNTs in flight. */
/** COUNTs in flight at once, up from 8. A COUNT is one small frame and one small reply. */
const COUNT_CONCURRENCY = 16

/** One COUNT should be fast or forgotten. */
/** Four seconds bought nothing: a relay that can answer a COUNT does it in well. */
const COUNT_TIMEOUT_MS = 2_000

/** How many notes carry each tag, asked rather than downloaded. */
async function countTags(
  tags: readonly string[],
  since: number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const queue = [...tags]

  const worker = async (): Promise<void> => {
    for (;;) {
      const tag = queue.shift()
      if (tag === undefined) return
      try {
        /* `skipUnresponsive`. */
        const total = await getPool().count(
          [{ kinds: [KINDS.shortNote], '#t': [tag], since }] as never,
          undefined,
          COUNT_TIMEOUT_MS,
          { skipUnresponsive: true },
        )
        if (total !== undefined) out.set(tag, total)
      } catch {
        // Unreachable or refused.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(COUNT_CONCURRENCY, queue.length) }, worker))
  return out
}

/** Below this a "trend" is one person, or one bot, repeating itself. */
const MIN_TAG_PEOPLE = 2
const TOPIC_TIMEOUT_MS = 9_000

/** Tags that are machinery rather than subjects. */
const MACHINE_TAG = /[0-9a-f]{16,}/i

function isBrowsableTag(tag: string): boolean {
  if (tag.length === 0 || tag.length > 40) return false
  if (MACHINE_TAG.test(tag)) return false
  // A tag that is only digits is a date or an id in almost every case.
  if (/^\d+$/.test(tag)) return false
  // Adult tags are searchable and browsable.
  if (!isPromotableTag(tag)) return false
  return true
}

/** How long a topic list stays fresh, scaled to the window it summarises. */
const MIN_TOPIC_TTL_MS = 5 * 60_000
const MAX_TOPIC_TTL_MS = 30 * 60_000

export function topicsTtlMs(hours: number): number {
  const scaled = (hours * 3_600_000) / 16
  return Math.min(MAX_TOPIC_TTL_MS, Math.max(MIN_TOPIC_TTL_MS, scaled))
}

/** The topic list, on disk. */
/** `v3`. */
// v4: ranked by notes rather than by people.
/** v5: every stored list written before this version was truncated to whichever caller. */
const TOPICS_KEY = 'nostrich:topics:v5'

interface StoredTopics {
  [window: string]: { at: number; topics: Topic[] }
}

function readTopicsStore(): StoredTopics {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(TOPICS_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as StoredTopics) : {}
  } catch {
    return {}
  }
}

export function readCachedTopics(hours: number): { at: number; topics: Topic[] } | undefined {
  const entry = readTopicsStore()[String(hours)]
  if (entry === undefined || !Array.isArray(entry.topics) || typeof entry.at !== 'number') {
    return undefined
  }
  return entry
}

/** A THINNER ANSWER NEVER REPLACES A FULLER ONE while the fuller one is still fresh. */
export function bestTopics(
  fresh: Topic[],
  held: { at: number; topics: Topic[] } | undefined,
  ttlMs: number,
  now: number,
): Topic[] {
  if (held === undefined || held.topics.length === 0) return fresh
  // A fresh draw at least as full as the one on screen is simply the better answer.
  if (fresh.length >= held.topics.length) return fresh
  // Thinner, and the held list is still fresh: one unlucky draw does not get to shrink.
  if (now - held.at <= ttlMs) return held.topics

  /* Borrowing has a ceiling, or a quiet network could never report itself. */
  if (now - held.at > ttlMs * BORROW_TTLS) return fresh

  // Thinner, expired, but recent enough to fill.
  const seen = new Set(fresh.map(topic => topic.tag))
  const filler = held.topics.filter(topic => !seen.has(topic.tag))
  return [...fresh, ...filler].slice(0, held.topics.length)
}

/** How many TTLs a held list may still be borrowed. */
const BORROW_TTLS = 6

/** Exported for the test beside. */
export function writeCachedTopics(hours: number, topics: Topic[]): void {
  if (typeof window === 'undefined') return
  /** An empty result is NEVER written. */
  if (topics.length === 0) return
  try {
    const store = readTopicsStore()
    store[String(hours)] = { at: Date.now(), topics }
    localStorage.setItem(TOPICS_KEY, JSON.stringify(store))
  } catch {
    // A full quota is not worth failing a render.
  }
}

export interface TopicsResult {
  topics: Topic[]
  loading: boolean
}

const NO_TOPICS: Topic[] = []

export function useTopics(enabled: boolean, max: number, hours = 24): TopicsResult {
  /** Keyed on `hours`, and that keying is not optional. */
  const cached = useMemo(() => readCachedTopics(hours), [hours])
  /** Read again, on every render, because the first one can be too early to see anything. */
  const placeholder = (): Topic[] | undefined => {
    const held = readCachedTopics(hours)
    return held === undefined || held.topics.length === 0 ? undefined : held.topics
  }

  const query = useQuery({
    queryKey: ['explore-topics', TOPIC_SAMPLE, hours],
    queryFn: async (): Promise<Topic[]> => {
      const since = Math.floor(Date.now() / 1000) - hours * 3_600
      /* A SHORTER SETTLE than the default second, because this is a sample and knows. */
      /* A FEW RELAYS, not all of them. */
      const sampleRelays = getPool().readRelays().slice(0, SAMPLE_RELAYS)
      const events = await getPool().query(
        [{ kinds: [KINDS.shortNote], since, limit: TOPIC_SAMPLE }],
        sampleRelays.length === 0 ? undefined : sampleRelays,
        TOPIC_TIMEOUT_MS,
        { graceMs: 300 },
      )

      const counts = new Map<string, number>()
      /* WHO used each tag, gathered in the same pass. */
      const people = new Map<string, Set<Hex>>()
      const seenEvents = new Set<string>()
      for (const event of events) {
        // The pool dedupes across relays, but a sample this wide is worth guarding twice: one.
        if (seenEvents.has(event.id)) continue
        seenEvents.add(event.id)

        // A tag-stuffed note is not evidence about any of its tags.
        if (isTagSpam(event)) continue

        // One count per note per tag: a note repeating #bitcoin nine times is one note.
        const seen = new Set<string>()
        for (const tag of event.tags) {
          if (tag[0] !== 't') continue
          const value = tag[1]?.toLowerCase().trim()
          if (value === undefined || !isBrowsableTag(value) || seen.has(value)) continue
          seen.add(value)
          counts.set(value, (counts.get(value) ?? 0) + 1)
          const authors = people.get(value) ?? new Set<Hex>()
          authors.add(event.pubkey)
          people.set(value, authors)
        }
      }

      /** The sample only NOMINATES. The counting is done by asking about each tag. */
      /** Nominate on ANY appearance, not on two. */
      const candidates = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TAG_CANDIDATES)
        .map(([tag]) => tag)

      if (candidates.length === 0) return []

      /** COUNT the candidates instead of downloading them. */
      const counted = await countTags(candidates, since)

      /* A tag no relay would count keeps its sample figure, marked as a floor. */
      const noteCountFor = (tag: string): { notes: number; atLeast: boolean } => {
        const exact = counted.get(tag)
        if (exact !== undefined) return { notes: exact, atLeast: false }
        return { notes: counts.get(tag) ?? 0, atLeast: true }
      }

      const ranked = candidates
        .map((tag): Topic => {
          const { notes, atLeast } = noteCountFor(tag)
          return {
            tag,
            notes,
            atLeast,
            // Distinct authors from the SAMPLE.
            score: people.get(tag)?.size ?? 0,
          }
        })
        // Two people is a conversation.
        .filter(topic => topic.score >= MIN_TAG_PEOPLE)
        /** Ranked by NOTES, which is the number printed on the row. */
        .sort((a, b) => b.notes - a.notes || b.score - a.score || a.tag.localeCompare(b.tag))

      /* NOT sliced to `max` here, and that is the fix for a list that could never grow. */
      /* A thinner draw does not get to shrink the panel. */
      const chosen = bestTopics(ranked, readCachedTopics(hours), topicsTtlMs(hours), Date.now())
      if (chosen === ranked) writeCachedTopics(hours, ranked)
      return chosen
    },
    enabled,
    /** An empty stored list is ignored rather than replayed. */
    ...(cached === undefined || cached.topics.length === 0
      ? {}
      : { initialData: cached.topics, initialDataUpdatedAt: cached.at }),
    placeholderData: placeholder,
    staleTime: topicsTtlMs(hours),
    // Outlives the staleTime deliberately.
    gcTime: topicsTtlMs(hours) * 2,
  })

  /** Sliced again on the way out. */
  const topics = useMemo(() => {
    const data = query.data ?? NO_TOPICS
    return data.length <= max ? data : data.slice(0, max)
  }, [query.data, max])

  return { topics, loading: query.isPending && enabled }
}
