import { describe, expect, it } from 'vitest'

import { engagementScore, satsBonus } from './engagement'

/* `quotes` belongs here: it is a required field of `EngagementCounts`. */
const base = { replies: 0, reposts: 0, quotes: 0, reactions: 0, zapCount: 0, zapSats: 0 }

describe('engagementScore', () => {
  it('weights a zapper above a repost or reply, and those above a reaction', () => {
    expect(engagementScore({ ...base, zapCount: 1 })).toBe(3)
    expect(engagementScore({ ...base, reposts: 1 })).toBe(2)
    expect(engagementScore({ ...base, replies: 1 })).toBe(2)
    expect(engagementScore({ ...base, reactions: 1 })).toBe(1)
  })

  it('weights a quote at exactly 1.5 reposts', () => {
    // A quote arrives as BOTH counters.
    const quote = engagementScore({ ...base, reposts: 1, quotes: 1 })
    const repost = engagementScore({ ...base, reposts: 1 })
    expect(quote).toBe(3)
    expect(quote).toBe(1.5 * repost)
    expect(engagementScore({ ...base, reposts: 2, quotes: 2 })).toBe(
      engagementScore({ ...base, reposts: 3 }),
    )
  })

  it('scores a quote its counter cannot tell apart as a plain repost', () => {
    // The honest floor for callers whose counts fold quotes into reposts.
    expect(engagementScore({ ...base, reposts: 1, quotes: 0 })).toBe(2)
  })

  it('lets a crowd of small zappers beat a whale, however large the whale', () => {
    // 10 people × 21 sats: 30 + 3 = 33. Two people, half a million sats: 6 + 7 = 13.
    const crowd = engagementScore({ ...base, zapCount: 10, zapSats: 210 })
    const whale = engagementScore({ ...base, zapCount: 2, zapSats: 500_000 })
    expect(crowd).toBe(33)
    expect(whale).toBe(13)
    expect(crowd).toBeGreaterThan(whale)
  })
})

describe('satsBonus', () => {
  it('is zero without two distinct zappers, whatever the amount', () => {
    expect(satsBonus(1_000_000, 0)).toBe(0)
    expect(satsBonus(1_000_000, 1)).toBe(0)
  })

  it('climbs the ladder: 1, 10, 100, 500, 1k, 5k, 10k', () => {
    expect(satsBonus(0, 2)).toBe(0)
    expect(satsBonus(1, 2)).toBe(1)
    expect(satsBonus(9, 2)).toBe(1)
    expect(satsBonus(10, 2)).toBe(2)
    expect(satsBonus(99, 2)).toBe(2)
    expect(satsBonus(100, 2)).toBe(3)
    expect(satsBonus(499, 2)).toBe(3)
    expect(satsBonus(500, 2)).toBe(4)
    expect(satsBonus(999, 2)).toBe(4)
    expect(satsBonus(1_000, 2)).toBe(5)
    expect(satsBonus(4_999, 2)).toBe(5)
    expect(satsBonus(5_000, 2)).toBe(6)
    expect(satsBonus(9_999, 2)).toBe(6)
    expect(satsBonus(10_000, 2)).toBe(7)
  })

  it('caps at 7 no matter how much money arrives', () => {
    expect(satsBonus(100_000_000, 50)).toBe(7)
  })
})
