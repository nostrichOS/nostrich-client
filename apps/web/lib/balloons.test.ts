import { describe, expect, it } from 'vitest'

import { laneLeftPx } from './balloons'

/** Where a balloon sits across the screen. */

/** A phone: five lanes across 390px, balloons at 3.2rem. */
const phone = { width: 390, band: 390 / 5, remSize: 3.2, jitter: 0 }
/** A desktop: eleven lanes across 1300px, balloons at 7rem. */
const desktop = { width: 1300, band: 1300 / 11, remSize: 7, jitter: 0 }

const right = (left: number, remSize: number): number => left + remSize * 16 * 1.15

describe('every balloon is inside the screen', () => {
  it('holds for every lane on a phone', () => {
    for (let lane = 0; lane < 5; lane += 1) {
      const left = laneLeftPx({ ...phone, lane })
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right(left, phone.remSize)).toBeLessThanOrEqual(phone.width)
    }
  })

  it('holds for every lane on a desktop, at the largest size', () => {
    for (let lane = 0; lane < 11; lane += 1) {
      const left = laneLeftPx({ ...desktop, lane })
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right(left, desktop.remSize)).toBeLessThanOrEqual(desktop.width)
    }
  })

  it('holds when the jitter pushes outward at both ends', () => {
    const outLeft = laneLeftPx({ ...phone, lane: 0, jitter: -phone.band })
    const outRight = laneLeftPx({ ...phone, lane: 4, jitter: phone.band })
    expect(outLeft).toBeGreaterThanOrEqual(0)
    expect(right(outRight, phone.remSize)).toBeLessThanOrEqual(phone.width)
  })

  it('starts at the left edge rather than off it when a balloon is wider than the screen', () => {
    // Not a real configuration, and exactly the case a clamp written the other way round.
    expect(laneLeftPx({ width: 100, band: 100, lane: 0, remSize: 7, jitter: 0 })).toBeGreaterThanOrEqual(0)
  })
})

describe('the balloon is centred on its lane', () => {
  it('puts the middle lane in the middle of the screen', () => {
    const left = laneLeftPx({ ...desktop, lane: 5 })
    const centre = left + (desktop.remSize * 16 * 1.15) / 2
    expect(Math.abs(centre - desktop.width / 2)).toBeLessThan(desktop.band / 2)
  })

  it('moves with the lane, one band at a time', () => {
    const first = laneLeftPx({ ...desktop, lane: 3 })
    const next = laneLeftPx({ ...desktop, lane: 4 })
    expect(next - first).toBeCloseTo(desktop.band, 5)
  })
})
