import { engagementScore } from './engagement'
import type { Counts } from './interactions'

/** How `/articles` decides what is trending. */

/** Engagement an article needs before it is ranked ABOVE the newest ones. */
export const TRENDING_FLOOR = 4

/** THE trending weighting. */
export function articleScore(counts: Counts | undefined): number {
  if (counts === undefined) return 0
  return engagementScore({
    replies: counts.replies,
    reposts: counts.reposts,
    quotes: counts.quotes,
    reactions: counts.likes,
    zapCount: counts.zapCount,
    zapSats: counts.zapSats,
  })
}

/** Two bands, not one ranking. */
export function rankArticles<T>(
  entries: readonly T[],
  score: (entry: T) => number,
  publishedAt: (entry: T) => number,
): T[] {
  return [...entries].sort((a, b) => {
    const left = score(a)
    const right = score(b)
    const leftRanks = left >= TRENDING_FLOOR
    const rightRanks = right >= TRENDING_FLOOR
    if (leftRanks !== rightRanks) return leftRanks ? -1 : 1
    if (!leftRanks) return publishedAt(b) - publishedAt(a)
    return right - left
  })
}
