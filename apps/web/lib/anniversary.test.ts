import { beforeEach, describe, expect, it } from 'vitest'

import {
  CELEBRATION_WINDOW_MS,
  claimCelebration,
  forgetCelebrations,
  isJoinAnniversary,
} from './anniversary'

/** When the balloons are allowed to fly. */

/** Seconds, from a local date. */
const at = (year: number, month: number, day: number, hour = 12): number =>
  Math.floor(new Date(year, month, day, hour).getTime() / 1_000)

const ALICE = 'a'.repeat(64)

describe('isJoinAnniversary', () => {
  const joined = at(2023, 7, 14) // 14 August 2023

  it('is the same day of the same month, a year or more later', () => {
    expect(isJoinAnniversary(joined, new Date(2024, 7, 14, 9))).toBe(true)
    expect(isJoinAnniversary(joined, new Date(2026, 7, 14, 23, 59))).toBe(true)
  })

  it('is not the day before or the day after', () => {
    expect(isJoinAnniversary(joined, new Date(2024, 7, 13, 23, 59))).toBe(false)
    expect(isJoinAnniversary(joined, new Date(2024, 7, 15, 0, 1))).toBe(false)
  })

  it('is not the same date in the year they joined', () => {
    // Nothing has come round yet.
    expect(isJoinAnniversary(joined, new Date(2023, 7, 14, 18))).toBe(false)
  })

  it('says nothing when the join date is unknown', () => {
    expect(isJoinAnniversary(undefined, new Date(2024, 7, 14))).toBe(false)
    expect(isJoinAnniversary(0, new Date(2024, 7, 14))).toBe(false)
  })

  describe('a leap-day account', () => {
    const leapling = at(2024, 1, 29) // 29 February 2024

    it('celebrates on the 29th when there is one', () => {
      expect(isJoinAnniversary(leapling, new Date(2028, 1, 29))).toBe(true)
    })

    it('celebrates on the 28th when there is not, rather than once every four years', () => {
      expect(isJoinAnniversary(leapling, new Date(2025, 1, 28))).toBe(true)
      expect(isJoinAnniversary(leapling, new Date(2025, 2, 1))).toBe(false)
    })

    it('leaves the 28th alone in a leap year, when the real day is still to come', () => {
      expect(isJoinAnniversary(leapling, new Date(2028, 1, 28))).toBe(false)
    })
  })
})

describe('claimCelebration', () => {
  beforeEach(() => {
    localStorage.clear()
    forgetCelebrations()
  })

  it('allows the first visit and refuses the ones straight after it', () => {
    const now = 1_700_000_000_000
    expect(claimCelebration(ALICE, now)).toBe(true)
    expect(claimCelebration(ALICE, now + 1_000)).toBe(false)
    expect(claimCelebration(ALICE, now + CELEBRATION_WINDOW_MS - 1)).toBe(false)
  })

  it('allows it again once the window has passed', () => {
    const now = 1_700_000_000_000
    expect(claimCelebration(ALICE, now)).toBe(true)
    expect(claimCelebration(ALICE, now + CELEBRATION_WINDOW_MS + 1)).toBe(true)
  })

  it('is per profile: two anniversaries on one day both get their balloons', () => {
    const bob = 'b'.repeat(64)
    const now = 1_700_000_000_000
    expect(claimCelebration(ALICE, now)).toBe(true)
    expect(claimCelebration(bob, now)).toBe(true)
  })
})
