import { describe, expect, it } from 'vitest'

import { anchorVisible, EDGE, GAP, MIN_HEIGHT, placeBelow } from './anchored'

/** The geometry a hover card is placed. */

const rect = (left: number, bottom: number): { left: number; bottom: number } => ({ left, bottom })

describe('placeBelow', () => {
  it('hangs the card under the anchor', () => {
    expect(placeBelow(rect(100, 200), 320, 1400, 900).top).toBe(200 + GAP)
  })

  it('never flips above, however little room is left below', () => {
    // Anchor at the very bottom of a short viewport: still below, still `bottom + GAP`.
    expect(placeBelow(rect(100, 880), 320, 1400, 900).top).toBe(880 + GAP)
  })

  it('lines the card up with the anchor when there is room', () => {
    expect(placeBelow(rect(400, 200), 320, 1400, 900).left).toBe(400)
  })

  it('clamps a card that would hang off the right edge', () => {
    // 1380 + 320 would end at 1700 on a 1400 viewport.
    expect(placeBelow(rect(1380, 200), 320, 1400, 900).left).toBe(1400 - 320 - EDGE)
  })

  it('keeps the left gutter on a viewport narrower than the card', () => {
    // Right clamp would be negative here.
    expect(placeBelow(rect(4, 200), 320, 300, 900).left).toBe(EDGE)
  })

  it('caps the height to the room below the anchor', () => {
    expect(placeBelow(rect(100, 200), 320, 1400, 900).maxHeight).toBe(900 - 200 - 2 * EDGE)
  })

  it('floors the height rather than collapsing on a short viewport', () => {
    // Room below is 12px.
    expect(placeBelow(rect(100, 880), 320, 1400, 900).maxHeight).toBe(MIN_HEIGHT)
  })
})

const box = (
  top: number,
  bottom: number,
  left = 100,
  right = 140,
): { top: number; bottom: number; left: number; right: number; width: number; height: number } => ({
  top,
  bottom,
  left,
  right,
  width: right - left,
  height: bottom - top,
})

describe('anchorVisible', () => {
  it('is true for an anchor on screen', () => {
    expect(anchorVisible(box(300, 340), 1400, 900)).toBe(true)
  })

  it('is true while the anchor is only partly on screen', () => {
    // Half off the top: the card follows it up rather than detaching.
    expect(anchorVisible(box(-20, 20), 1400, 900)).toBe(true)
  })

  it('is false once the anchor has scrolled off the top', () => {
    expect(anchorVisible(box(-60, -20), 1400, 900)).toBe(false)
  })

  it('is false once the anchor has scrolled off the bottom', () => {
    expect(anchorVisible(box(920, 960), 1400, 900)).toBe(false)
  })

  it('is false horizontally too', () => {
    expect(anchorVisible(box(300, 340, 1420, 1460), 1400, 900)).toBe(false)
  })

  /** An unlaid-out element measures all zeros, and a zero rect passes `bottom > 0`'s. */
  it('treats an unlaid-out zero rect as gone rather than as at the origin', () => {
    expect(anchorVisible(box(0, 0, 0, 0), 1400, 900)).toBe(false)
  })
})
