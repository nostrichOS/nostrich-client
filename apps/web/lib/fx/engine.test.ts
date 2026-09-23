import { describe, expect, it } from 'vitest'

import { TIER_SCALE, tierFor } from './engine'
import { formatCount } from './count'

/** The one thing about the effects that is a decision rather than a drawing: how big. */

describe('tierFor', () => {
  it('puts each band on the right side of its boundary', () => {
    expect(tierFor(1)).toBe(1)
    expect(tierFor(99)).toBe(1)
    expect(tierFor(100)).toBe(2)
    expect(tierFor(499)).toBe(2)
    expect(tierFor(500)).toBe(3)
    expect(tierFor(999)).toBe(3)
    expect(tierFor(1_000)).toBe(4)
    expect(tierFor(4_999)).toBe(4)
    expect(tierFor(5_000)).toBe(5)
    expect(tierFor(21_000)).toBe(5)
    expect(tierFor(100_000_000)).toBe(5)
  })

  it('never returns a tier the scale has no entry for', () => {
    for (const sats of [0, 1, 21, 210, 2_100, 21_000]) {
      expect(TIER_SCALE[tierFor(sats)]).toBeGreaterThan(0)
    }
  })

  it('grows monotonically, which is the whole point', () => {
    const scales = [21, 210, 2_100, 21_000].map(sats => TIER_SCALE[tierFor(sats)] as number)
    for (let i = 1; i < scales.length; i += 1) {
      expect(scales[i] as number).toBeGreaterThan(scales[i - 1] as number)
    }
  })
})

describe('the row’s count format', () => {
  it('matches the reference: K above a thousand, one decimal below ten', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1_000)).toBe('1K')
    expect(formatCount(1_200)).toBe('1.2K')
    expect(formatCount(4_712)).toBe('4.7K')
    expect(formatCount(9_999)).toBe('10K')
    expect(formatCount(10_000)).toBe('10K')
    expect(formatCount(21_000)).toBe('21K')
    expect(formatCount(1_249)).toBe('1.2K')
  })
})
