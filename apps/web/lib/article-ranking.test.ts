import { describe, expect, it } from 'vitest'

import { TRENDING_FLOOR, articleScore, rankArticles } from './article-ranking'
import type { Counts } from './interactions'

const counts = (over: Partial<Counts> = {}): Counts =>
  ({ replies: 0, reposts: 0, quotes: 0, likes: 0, zapSats: 0, zapCount: 0, replyAuthors: [], ...over }) as Counts

describe('articleScore', () => {
  it('is zero for an article nothing is known about', () => {
    expect(articleScore(undefined)).toBe(0)
  })

  it('ranks on the unified weighting: zapper above reply and repost, those above a like', () => {
    // The same `engagementScore` the notes chart uses.
    expect(articleScore(counts({ zapCount: 1 }))).toBeGreaterThan(articleScore(counts({ replies: 1 })))
    expect(articleScore(counts({ replies: 1 }))).toBe(articleScore(counts({ reposts: 1 })))
    expect(articleScore(counts({ reposts: 1 }))).toBeGreaterThan(articleScore(counts({ likes: 1 })))
  })

  it('gives a lone zapper no sats bonus, however large the zap', () => {
    expect(articleScore(counts({ zapCount: 1, zapSats: 1_000_000 }))).toBe(
      articleScore(counts({ zapCount: 1 })),
    )
  })

  it('caps the sats bonus, so one big pile of money cannot bury everything', () => {
    // Two zappers and a fortune: 6 people points + the ceiling of 7. Ten modest zappers.
    expect(articleScore(counts({ zapCount: 2, zapSats: 1_000_000 }))).toBe(13)
    expect(articleScore(counts({ zapCount: 10, zapSats: 210 }))).toBe(33)
  })
})

describe('rankArticles', () => {
  const entry = (id: string, score: number, at: number) => ({ id, score, at })
  const rank = (list: ReturnType<typeof entry>[]) =>
    rankArticles(list, e => e.score, e => e.at).map(e => e.id)

  it('puts everything above the floor before everything below it', () => {
    expect(rank([entry('quiet', 0, 900), entry('busy', TRENDING_FLOOR, 100)])).toEqual(['busy', 'quiet'])
  })

  it('ranks the busy band by score', () => {
    expect(rank([entry('a', 10, 1), entry('b', 40, 1)])).toEqual(['b', 'a'])
  })

  it('keeps the quiet band in date order, newest first', () => {
    expect(rank([entry('old', 1, 100), entry('new', 1, 900)])).toEqual(['new', 'old'])
  })

  it('a single like does not make an article trend', () => {
    // One like scores 1, well under the floor, so date order still decides.
    expect(rank([entry('liked', 1, 100), entry('newer', 0, 900)])).toEqual(['newer', 'liked'])
  })

  it('does not mutate the list it was given', () => {
    const list = [entry('a', 1, 1), entry('b', 9, 1)]
    rank(list)
    expect(list.map(e => e.id)).toEqual(['a', 'b'])
  })
})
