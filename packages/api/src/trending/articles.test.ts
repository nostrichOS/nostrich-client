import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import { addressOf, heat, newestPerAddress, rankArticles, readable } from './articles'

/** The three rules the Articles chart was reported for, each one a live complaint. */

const key = (n: number): string => n.toString(16).padStart(64, '0')
const AUTHOR = key(1)
const OTHER = key(2)
const THIRD = key(3)

const NOW = 1_700_000_000

const article = (id: string, over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id,
    pubkey: AUTHOR,
    kind: 30023,
    created_at: NOW,
    content: 'x'.repeat(500),
    tags: [
      ['title', 'A piece of writing'],
      ['d', id],
    ],
    sig: '',
    ...over,
  }) as NostrEvent

const counts = (
  over: Partial<{
    replies: number
    reposts: number
    quotes: number
    reactions: number
    zapCount: number
  }> = {},
) => ({
  replies: 0,
  reposts: 0,
  // Required by `SourceCounts`, and a SUBSET of reposts rather than a sibling.
  quotes: 0,
  reactions: 0,
  zapCount: 0,
  zapSats: 0,
  ...over,
})

describe('rankArticles', () => {
  it('never lists an article nobody touched', () => {
    const out = rankArticles([{ event: article('quiet'), counts: counts() }])
    expect(out).toEqual([])
  })

  it('never lists an article one person liked, one person is not a trend', () => {
    expect(rankArticles([{ event: article('one-like'), counts: counts({ reactions: 1 }) }])).toEqual([])
    expect(rankArticles([{ event: article('one-reply'), counts: counts({ replies: 1 }) }])).toEqual([])
    expect(rankArticles([{ event: article('one-repost'), counts: counts({ reposts: 1 }) }])).toEqual([])
  })

  it('lists an article ONE person zapped, money is not the same signal as a like', () => {
    const out = rankArticles([{ event: article('paid'), counts: counts({ zapCount: 1 }) }])
    expect(out.map(note => note.id)).toEqual(['paid'])
  })

  it('lists an article two different people touched, however lightly', () => {
    const out = rankArticles([{ event: article('two'), counts: counts({ reactions: 2 }) }])
    expect(out.map(note => note.id)).toEqual(['two'])
  })

  it('ranks on the same weighting the notes chart uses', () => {
    // zapCount×3, reposts×2, replies×2, reactions×1. One zapper (3) beats two likes (2).
    const out = rankArticles([
      { event: article('liked', { pubkey: OTHER }), counts: counts({ reactions: 2 }) },
      { event: article('zapped'), counts: counts({ zapCount: 1 }) },
    ])
    expect(out.map(note => note.id)).toEqual(['zapped', 'liked'])
    expect(out[0]?.score).toBe(3)
  })

  it('a lone whale earns no sats bonus, and never outranks more people', () => {
    // The sats total feeds only `engagementScore`'s capped bonus, and that bonus is gated.
    const out = rankArticles([
      { event: article('whale'), counts: { ...counts({ zapCount: 1 }), zapSats: 500_000 } },
      { event: article('many', { pubkey: OTHER }), counts: { ...counts({ zapCount: 2 }), zapSats: 42 } },
    ])
    expect(out.map(note => note.id)).toEqual(['many', 'whale'])
    expect(out[0]?.score).toBe(8)
    expect(out[1]?.score).toBe(3)
  })

  it('keeps at most two articles per author, and they are their best two', () => {
    // Reactions rather than one apiece, so nothing here is dropped by the engagement floor.
    const mine = (id: string, reactions: number) => ({
      event: article(id, { id, tags: [['title', 'T'], ['d', id]] }),
      counts: counts({ reactions }),
    })
    const out = rankArticles(
      [mine('third', 2), mine('best', 9), mine('second', 5), { event: article('theirs', { pubkey: OTHER }), counts: counts({ reactions: 7 }) }],
      undefined,
      NOW,
    )
    expect(out.map(note => note.id)).toEqual(['best', 'theirs', 'second'])
    expect(out.filter(note => note.pubkey === AUTHOR)).toHaveLength(2)
  })

  it('breaks a tie on recency, so the newer piece leads', () => {
    const out = rankArticles(
      [
        { event: article('older', { created_at: NOW - 86_400 }), counts: counts({ reactions: 4 }) },
        { event: article('newer', { pubkey: OTHER, created_at: NOW }), counts: counts({ reactions: 4 }) },
      ],
      undefined,
      NOW,
    )
    expect(out.map(note => note.id)).toEqual(['newer', 'older'])
  })

  /** The reported case, with its real numbers. */
  it('prefers a fresh article over a month-old one that merely had longer to collect', () => {
    const out = rankArticles(
      [
        { event: article('tor', { created_at: NOW - 25 * 86_400 }), counts: counts({ reactions: 12, zapCount: 1 }) },
        { event: article('nym', { created_at: NOW - 3 * 86_400 }), counts: counts({ reactions: 7, zapCount: 1 }) },
      ],
      undefined,
      NOW,
    )
    // Raw scores are 15 and 10.
    expect(out.map(note => note.id)).toEqual(['nym', 'tor'])
  })

  it('still lets a genuinely big piece hold the top against a small fresh one', () => {
    const out = rankArticles(
      [
        { event: article('big', { created_at: NOW - 28 * 86_400 }), counts: counts({ reactions: 36, reposts: 5, zapCount: 15 }) },
        { event: article('small', { pubkey: OTHER, created_at: NOW - 86_400 }), counts: counts({ reactions: 2 }) },
      ],
      undefined,
      NOW,
    )
    expect(out.map(note => note.id)).toEqual(['big', 'small'])
  })

  it('reports the RAW score, not the aged one, the card shows counts beside it', () => {
    const [top] = rankArticles(
      [{ event: article('x', { created_at: NOW - 20 * 86_400 }), counts: counts({ reactions: 4 }) }],
      undefined,
      NOW,
    )
    expect(top?.score).toBe(4)
  })

  it('stops at the cap', () => {
    const many = Array.from({ length: 9 }, (_, at) => ({
      event: article(`n${at}`, { pubkey: key(at + 10) }),
      counts: counts({ reactions: at + 2 }),
    }))
    expect(rankArticles(many, 5, NOW)).toHaveLength(5)
  })

  it('carries the counts it ranked on, so the card needs no request to draw them', () => {
    const [top] = rankArticles([
      { event: article('x'), counts: counts({ replies: 2, reposts: 1, reactions: 3, zapCount: 4 }) },
    ])
    expect(top?.counts).toMatchObject({ replies: 2, reposts: 1, reactions: 3, zapCount: 4 })
  })
})

describe('newestPerAddress', () => {
  it('keeps one event per addressable coordinate, an edit is not a second article', () => {
    const first = article('v1', { created_at: 100, tags: [['title', 'T'], ['d', 'slug']] })
    const edit = article('v2', { created_at: 200, tags: [['title', 'T'], ['d', 'slug']] })
    expect(newestPerAddress([first, edit]).map(event => event.id)).toEqual(['v2'])
  })

  it('treats the same slug from different authors as different articles', () => {
    const mine = article('a', { tags: [['title', 'T'], ['d', 'slug']] })
    const theirs = article('b', { pubkey: THIRD, tags: [['title', 'T'], ['d', 'slug']] })
    expect(newestPerAddress([mine, theirs])).toHaveLength(2)
  })

  it('addresses as kind:pubkey:d, which is what every client tags', () => {
    expect(addressOf(article('a', { tags: [['d', 'my-post']] }))).toBe(`30023:${AUTHOR}:my-post`)
  })
})

describe('readable', () => {
  it('needs a title', () => {
    expect(readable(article('a', { tags: [['d', 'a']] }))).toBe(false)
  })

  it('needs more than a placeholder under it', () => {
    expect(readable(article('a', { content: 'testing 123' }))).toBe(false)
  })

  it('accepts an ordinary piece', () => {
    expect(readable(article('a'))).toBe(true)
  })
})

describe('heat', () => {
  it('is the raw score when an article is brand new, near enough', () => {
    // (0 + 2) ^ 0.5 = 1.41, so a fresh article keeps about 70% of its score.
    expect(heat(10, 0)).toBeCloseTo(7.07, 2)
  })

  it('halves roughly every fourfold increase in age', () => {
    expect(heat(100, 6 * 3_600) / heat(100, 30 * 3_600)).toBeCloseTo(2, 1)
  })

  it('never lets age turn a score negative or infinite', () => {
    expect(heat(10, -5)).toBeCloseTo(7.07, 2)
    expect(Number.isFinite(heat(10, 400 * 86_400))).toBe(true)
  })
})
