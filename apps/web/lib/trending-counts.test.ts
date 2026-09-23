import { describe, expect, it } from 'vitest'
import type { NoteCounts } from '@nostrich/app'

import { mergeTrendingCounts } from './trending-counts'

/** Both failures came from the deployed trending tab, and both looked like the app. */

const NOTE = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const map = (...pairs: [string, NoteCounts][]): Map<string, NoteCounts> => new Map(pairs)
const none = new Map<string, NoteCounts>()

describe('mergeTrendingCounts', () => {
  it('takes the larger claim per field, from either the index or the live tally', () => {
    // The index knows the whole network at build time.
    const merged = mergeTrendingCounts(
      map([NOTE, { replies: 10, reposts: 2, likes: 19, zapSats: 50 }]),
      map([NOTE, { replies: 1, reposts: 0, likes: 3, zapSats: 50 }]),
      none,
    )
    expect(merged.get(NOTE)).toEqual({ replies: 10, reposts: 2, likes: 19, zapSats: 50 })
  })

  it('never lets the index drag a live count down', () => {
    /* THE FROZEN-COUNTER BUG, pinned. */
    const merged = mergeTrendingCounts(
      map([NOTE, { replies: 10, reposts: 2, likes: 19, zapSats: 50 }]),
      none,
      map([NOTE, { replies: 10, reposts: 3, likes: 20, zapSats: 50 }]),
    )
    expect(merged.get(NOTE)?.likes).toBe(20)
    expect(merged.get(NOTE)?.reposts).toBe(3)
    expect(merged.get(NOTE)?.replies).toBe(10)
  })

  it('takes our own zap total when the index reports fewer sats than we hold receipts for', () => {
    const merged = mergeTrendingCounts(
      map([NOTE, { replies: 10, reposts: 2, likes: 19, zapSats: 0 }]),
      map([NOTE, { replies: 0, reposts: 0, likes: 0, zapSats: 50 }]),
      none,
    )
    expect(merged.get(NOTE)?.zapSats).toBe(50)
    // Everything else still comes from the index.
    expect(merged.get(NOTE)?.replies).toBe(10)
  })

  it('keeps the index zap total when our relays saw fewer receipts', () => {
    const merged = mergeTrendingCounts(
      map([NOTE, { zapSats: 900 }]),
      map([NOTE, { replies: 0, reposts: 0, likes: 0, zapSats: 21 }]),
      none,
    )
    expect(merged.get(NOTE)?.zapSats).toBe(900)
  })

  it('falls back to the local tally for a card the index has no row for', () => {
    const merged = mergeTrendingCounts(
      map([OTHER, { replies: 4, zapSats: 0 }]),
      none,
      map([NOTE, { replies: 2, reposts: 0, likes: 3, zapSats: 21 }]),
    )
    expect(merged.get(NOTE)).toEqual({ replies: 2, reposts: 0, likes: 3, zapSats: 21 })
    expect(merged.get(OTHER)?.replies).toBe(4)
  })

  it('lets the index override a filled entry rather than the other way round', () => {
    const merged = mergeTrendingCounts(
      map([NOTE, { replies: 10, zapSats: 0 }]),
      none,
      map([NOTE, { replies: 2, zapSats: 0 }]),
    )
    expect(merged.get(NOTE)?.replies).toBe(10)
  })

  it('treats a missing zapSats as zero rather than making the note vanish', () => {
    const merged = mergeTrendingCounts(
      map([NOTE, { replies: 3 }]),
      map([NOTE, { replies: 0, reposts: 0, likes: 0, zapSats: 7 }]),
      none,
    )
    expect(merged.get(NOTE)).toEqual({ replies: 3, zapSats: 7 })
  })
})
