import { describe, expect, it } from 'vitest'

import { fitBox, previewBox, PREVIEW_MAX_HEIGHT } from './preview-fit'

/** The bands down each side of a tall attachment in the composer, and the arithmetic. */

describe('fitBox', () => {
  it('gives the box the picture’s own shape', () => {
    expect(fitBox(16 / 9)?.aspectRatio).toBe(String(16 / 9))
  })

  it('caps a tall picture by width, so it lands exactly at the height cap', () => {
    const portrait = 3 / 4
    const box = fitBox(portrait)
    const maxWidth = Number.parseInt(String(box?.maxWidth), 10)
    // Width × (1/ratio) is the height it will actually take: the cap, and not a pixel more.
    expect(Math.round(maxWidth / portrait)).toBe(PREVIEW_MAX_HEIGHT)
  })

  it('leaves a wide picture free to fill the column', () => {
    // 16:9 at the cap is 910px.
    const maxWidth = Number.parseInt(String(fitBox(16 / 9)?.maxWidth), 10)
    expect(maxWidth).toBeGreaterThan(880)
  })

  it('says nothing at all until the shape is known', () => {
    for (const unknown of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fitBox(unknown as number | undefined)).toBeUndefined()
    }
  })
})

/** The preview rule, twice reported and now pinned. */
describe('previewBox', () => {
  const CAP = 288

  it('lets a landscape picture fill the column, with no cap in either direction', () => {
    const box = previewBox(16 / 9, CAP)
    expect(box.sized).toBe(true)
    expect(box.style.aspectRatio).toBe(String(16 / 9))
    expect(box.style.maxWidth).toBeUndefined()
    expect(box.style.maxHeight).toBeUndefined()
  })

  it('lets a square picture fill the column too', () => {
    expect(previewBox(1, CAP).style.maxWidth).toBeUndefined()
  })

  it('lets a NEAR-square picture fill it, the 0.98 screenshot that was reported', () => {
    const box = previewBox(0.98, CAP)
    expect(box.style.aspectRatio).toBe('0.98')
    expect(box.style.maxWidth).toBeUndefined()
    expect(box.style.maxHeight).toBeUndefined()
  })

  it('caps a portrait by width, so it lands exactly at the height cap', () => {
    const portrait = 3 / 4
    const box = previewBox(portrait, CAP)
    const maxWidth = Number.parseInt(String(box.style.maxWidth), 10)
    expect(Math.round(maxWidth / portrait)).toBe(CAP)
  })

  it('holds the boundary where mediaPreset does, not at 1', () => {
    // 0.9 and above is not a portrait.
    expect(previewBox(0.9, CAP).style.maxWidth).toBeUndefined()
    expect(previewBox(0.89, CAP).style.maxWidth).toBeDefined()
  })

  it('holds the picture down but gives it no shape until one is known', () => {
    for (const unknown of [undefined, 0, -1, Number.NaN]) {
      const box = previewBox(unknown as number | undefined, CAP)
      expect(box.sized).toBe(false)
      expect(box.style.aspectRatio).toBeUndefined()
      expect(box.style.maxHeight).toBe(`${CAP}px`)
    }
  })
})
