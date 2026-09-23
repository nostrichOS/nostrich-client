import { describe, expect, it } from 'vitest'

import { liftZapCounts } from './interactions'
import type { ZapDetail } from './interactions'

/** Four zaps, two counted. */
const zap = (sats: number, at: number): ZapDetail => ({ sender: 'a'.repeat(64) as never, sats, at })

const base = {
  replies: 3,
  likes: 9,
  reposts: 2,
  quotes: 1,
  zapSats: 63,
  zapCount: 2,
  replyAuthors: [],
} as never

describe('liftZapCounts', () => {
  it('raises the count and the total to the authoritative answer', () => {
    // The real note: the batched tally saw two of the four receipts.
    const lifted = liftZapCounts(base, [zap(21, 4), zap(21, 3), zap(42, 2), zap(42, 1)])
    expect(lifted?.zapCount).toBe(4)
    expect(lifted?.zapSats).toBe(126)
  })

  it('leaves every other count alone', () => {
    const lifted = liftZapCounts(base, [zap(21, 1), zap(21, 2), zap(42, 3), zap(42, 4)])
    expect(lifted?.replies).toBe(3)
    expect(lifted?.likes).toBe(9)
    expect(lifted?.reposts).toBe(2)
    expect(lifted?.quotes).toBe(1)
  })

  it('NEVER lowers a number, a thin answer from a slow relay cannot erase a zap', () => {
    // The whole reason this is a high-water merge rather than a replacement.
    const lifted = liftZapCounts(base, [zap(21, 1)])
    expect(lifted?.zapCount).toBe(2)
    expect(lifted?.zapSats).toBe(63)
  })

  it('returns the same object when nothing moved, so consumers do not re-render', () => {
    const lifted = liftZapCounts(base, [zap(21, 1)])
    expect(lifted).toBe(base)
  })

  it('keeps the batched counts untouched while the note query has not answered', () => {
    expect(liftZapCounts(base, [])).toBe(base)
  })

  it('builds a count from zaps alone when the tally knows nothing of the note', () => {
    const lifted = liftZapCounts(undefined, [zap(21, 1), zap(42, 2)])
    expect(lifted?.zapCount).toBe(2)
    expect(lifted?.zapSats).toBe(63)
    expect(lifted?.replies).toBe(0)
  })

  it('has nothing to say about a note with no zaps and no tally', () => {
    expect(liftZapCounts(undefined, [])).toBeUndefined()
  })
})
