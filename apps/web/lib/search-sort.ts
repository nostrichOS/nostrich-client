import type { NoteCounts } from '@nostrich/app'
import type { NostrEvent } from '@nostrich/nostr'

import { engagementScore } from './engagement'

/** How search results are ordered, and why the ordering is done here rather. */

export const SEARCH_SORTS = ['recent', 'relevance', 'top'] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  recent: 'Newest',
  relevance: 'Relevance',
  /* "Top" alone said which end of something, never. */
  top: 'Top Reach',
}

/** Newest first, ties broken by id. */
function byNewest(a: NostrEvent, b: NostrEvent): number {
  return b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** A whole-word hit, so "art" does not score itself on "start". */
function wholeWordCount(haystack: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let at = 0
  for (;;) {
    const found = haystack.indexOf(needle, at)
    if (found === -1) return count
    const before = found === 0 ? '' : haystack[found - 1]!
    const after = haystack[found + needle.length] ?? ''
    if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) count += 1
    at = found + needle.length
  }
}

/** Terms found early are what the note. */
const HEAD_CHARS = 120
/** Beyond this a "match" is a mention inside an essay, not the subject of the note. */
const LONG_NOTE_CHARS = 900
/** Half-life of the tie-break nudge, in days. */
const RECENCY_HALF_LIFE_DAYS = 30

/** How well a note answers the query. */
export function relevanceScore(event: NostrEvent, want: readonly string[], now: number): number {
  if (want.length === 0) return 0

  const content = event.content.toLowerCase()
  const head = content.slice(0, HEAD_CHARS)
  const hashtags = new Set(
    event.tags.filter(tag => tag[0] === 't' && typeof tag[1] === 'string').map(tag => tag[1]!.toLowerCase()),
  )

  let score = 0

  // The phrase, whole and in order.
  const phrase = want.join(' ')
  if (want.length > 1 && content.includes(phrase)) score += 40

  for (const term of want) {
    if (hashtags.has(term)) score += 25

    const whole = wholeWordCount(content, term)
    if (whole > 0) {
      score += 12
      // Repetition, capped: the second and third hit count, the thirtieth does.
      score += Math.min(whole - 1, 2) * 4
    } else if (content.includes(term)) {
      // A substring hit still counts.
      score += 5
    }

    if (head.includes(term)) score += 8
  }

  // Every term present at all.
  if (want.every(term => content.includes(term) || hashtags.has(term))) score += 20

  if (content.length > LONG_NOTE_CHARS) score -= 6

  // A gentle nudge, never a decider: at one half-life it is worth less than a single.
  const ageDays = Math.max(0, (now - event.created_at) / 86_400)
  score += 6 * Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS)

  return score
}

/** Order a result set. */
export function sortSearch(
  notes: readonly NostrEvent[],
  sort: SearchSort,
  want: readonly string[],
  counts: ReadonlyMap<string, NoteCounts>,
  now: number = Math.floor(Date.now() / 1000),
): NostrEvent[] {
  const list = [...notes]

  if (sort === 'recent') return list.sort(byNewest)

  if (sort === 'relevance') {
    const scores = new Map(list.map(event => [event.id, relevanceScore(event, want, now)]))
    return list.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || byNewest(a, b))
  }

  const scores = new Map(
    list.map(event => {
      const held = counts.get(event.id)
      return [
        event.id,
        held === undefined
          ? 0
          : // Every field of the shared `NoteCounts` is optional, a count nobody has
            // fetched yet is absent rather than zero, which is the distinction the note cards.
            engagementScore({
              replies: held.replies ?? 0,
              reposts: held.reposts ?? 0,
              quotes: held.quotes ?? 0,
              reactions: held.likes ?? 0,
              zapCount: held.zapCount ?? 0,
              zapSats: held.zapSats ?? 0,
            }),
      ] as const
    }),
  )
  return list.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || byNewest(a, b))
}
