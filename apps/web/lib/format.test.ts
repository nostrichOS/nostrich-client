import { describe, expect, it } from 'vitest'

import { compactCount, floorCount, joinedMonth, relativeTime, relativeTimeShort } from './format'

/** 2026-08-19T00:00:00Z, the day this was written. */
const AUGUST = Math.floor(Date.UTC(2026, 7, 19, 12) / 1000)

describe('floorCount', () => {
  it('rounds down, always', () => {
    expect(floorCount(0)).toBe('0')
    expect(floorCount(999)).toBe('999')
    expect(floorCount(1_000)).toBe('1k')
    expect(floorCount(1_299)).toBe('1.2k')
    expect(floorCount(9_999)).toBe('9.9k')
    expect(floorCount(10_000)).toBe('10k')
    expect(floorCount(274_429)).toBe('274k')
    expect(floorCount(274_629)).toBe('274k')
    expect(floorCount(999_999)).toBe('999k')
    expect(floorCount(1_000_000)).toBe('1m')
    expect(floorCount(1_299_999)).toBe('1.2m')
  })

  it('never claims more people than were counted', () => {
    // The property that matters: this number is shown with a "+" meaning "at least.
    const parse = (shown: string): number =>
      shown.endsWith('m')
        ? Number(shown.slice(0, -1)) * 1_000_000
        : shown.endsWith('k')
          ? Number(shown.slice(0, -1)) * 1_000
          : Number(shown)
    for (let n = 0; n < 2_000_000; n += 997) {
      expect(parse(floorCount(n)), `floorCount(${n})`).toBeLessThanOrEqual(n)
    }
  })

  it('is the half-up twin of compactCount, which is why both exist', () => {
    // Kept as documentation of the difference, not as approval of it: compactCount.
    expect(compactCount(274_629)).toBe('275k')
    expect(floorCount(274_629)).toBe('274k')
  })
})

describe('joined date', () => {
  it('is a month and a year, never a day', () => {
    // A join date on Nostr is inferred.
    expect(joinedMonth(AUGUST)).toBe('August 2026')
  })
})

/** The sidebar clock. */
describe('relativeTimeShort', () => {
  const NOW = 1_800_000_000
  const ago = (seconds: number) => relativeTimeShort(NOW - seconds, NOW)

  it('matches relativeTime for anything under a week', () => {
    for (const seconds of [5, 90, 3 * 3600, 4 * 86_400]) {
      expect(ago(seconds)).toBe(relativeTime(NOW - seconds, NOW))
    }
  })

  it('keeps going in weeks and months instead of printing a date', () => {
    expect(ago(10 * 86_400)).toBe('1w')
    expect(ago(21 * 86_400)).toBe('3w')
    expect(ago(45 * 86_400)).toBe('1mo')
    expect(ago(400 * 86_400)).toBe('13mo')
  })

  it('never returns something with a space in it, which is what wrapped the column', () => {
    for (const seconds of [1, 3_600, 86_400, 20 * 86_400, 200 * 86_400]) {
      expect(ago(seconds)).not.toMatch(/\s/)
    }
  })

  it('does not go negative for a clock that is ahead of us', () => {
    expect(relativeTimeShort(NOW + 500, NOW)).toBe('0s')
  })
})
