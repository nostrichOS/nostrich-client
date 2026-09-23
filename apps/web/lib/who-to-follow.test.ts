import { describe, expect, it } from 'vitest'

import { pickSuggestions, reconcileSuggestions } from './who-to-follow'

/** The panel deals five names from the 4h trending authors and holds them for an hour. */
const key = (n: number): string => String(n).padStart(64, '0')

describe('pickSuggestions', () => {
  const pool = Array.from({ length: 40 }, (_, i) => key(i))

  it('is stable within an hour and moves when the hour turns', () => {
    const a = pickSuggestions([pool], undefined, 100)
    expect(pickSuggestions([pool], undefined, 100)).toEqual(a)
    expect(pickSuggestions([pool], undefined, 101)).not.toEqual(a)
  })

  it('deals a different five to each reader, so exposure is not stacked on one set', () => {
    const anon = pickSuggestions([pool], undefined, 100)
    const alice = pickSuggestions([pool], key(900), 100)
    const bob = pickSuggestions([pool], key(901), 100)
    expect(alice).not.toEqual(anon)
    expect(alice).not.toEqual(bob)
  })

  it('never suggests you, or anyone you already follow', () => {
    const me = key(3)
    const following = new Set([key(5), key(7)])
    const picks = pickSuggestions([pool], me, 100, following)
    expect(picks).not.toContain(me)
    expect(picks).not.toContain(key(5))
    expect(picks).not.toContain(key(7))
  })

  it('returns at most five, and fewer without complaint', () => {
    expect(pickSuggestions([pool], undefined, 100)).toHaveLength(5)
    expect(pickSuggestions([pool.slice(0, 2)], undefined, 100)).toHaveLength(2)
    expect(pickSuggestions([[]], undefined, 100)).toEqual([])
  })

  it('never repeats an author, however often they appear in the window', () => {
    const noisy = [key(1), key(1), key(1), key(2), key(2), key(3)]
    expect(pickSuggestions([noisy], undefined, 100)).toHaveLength(3)
  })
})

/** The window fallback: 4h is the source, and 1h then 24h only make up the numbers. */
describe('pickSuggestions across windows', () => {
  const four = [key(1), key(2)]
  const one = [key(3)]
  const day = [key(4), key(5), key(6), key(7)]

  it('fills from the later windows only when the first runs short', () => {
    const picks = pickSuggestions([four, one, day], undefined, 100)
    expect(picks).toHaveLength(5)
    // Every four-hour author is present.
    expect(picks.slice(0, 2).sort()).toEqual([key(1), key(2)])
    expect(picks[2]).toBe(key(3))
  })

  it('never reaches past the first window when that window can fill it', () => {
    const plenty = Array.from({ length: 9 }, (_, i) => key(100 + i))
    const picks = pickSuggestions([plenty, one, day], undefined, 100)
    expect(picks).toHaveLength(5)
    expect(picks.every(p => plenty.includes(p))).toBe(true)
  })

  it('does not repeat somebody who appears in two windows', () => {
    const picks = pickSuggestions([[key(1)], [key(1), key(2)], []], undefined, 100)
    expect(picks).toEqual([key(1), key(2)])
  })
})

/** Following one person must replace THAT person and nobody else. */
describe('reconcileSuggestions', () => {
  const pool = Array.from({ length: 12 }, (_, i) => key(i))

  it('fills five on a first call', () => {
    expect(reconcileSuggestions([], pool, new Set())).toEqual(pool.slice(0, 5))
  })

  it('replaces only the followed slot, in place', () => {
    const shown = reconcileSuggestions([], pool, new Set())
    const after = reconcileSuggestions(shown, pool, new Set([shown[2] as string]))
    expect(after).toHaveLength(5)
    // Everybody else kept their position.
    expect(after[0]).toBe(shown[0])
    expect(after[1]).toBe(shown[1])
    expect(after[3]).toBe(shown[3])
    expect(after[4]).toBe(shown[4])
    // And the followed one is gone, replaced by somebody new.
    expect(after[2]).not.toBe(shown[2])
    expect(shown).not.toContain(after[2])
  })

  it('is a no-op when nothing has been followed', () => {
    const shown = reconcileSuggestions([], pool, new Set())
    expect(reconcileSuggestions(shown, pool, new Set())).toEqual(shown)
  })

  it('never brings back somebody already on screen', () => {
    const shown = reconcileSuggestions([], pool, new Set())
    const after = reconcileSuggestions(shown, pool, new Set([shown[0] as string]))
    expect(new Set(after).size).toBe(after.length)
  })

  it('shrinks rather than repeating when the pool runs out', () => {
    const tiny = [key(1), key(2)]
    const shown = reconcileSuggestions([], tiny, new Set())
    expect(shown).toEqual(tiny)
    expect(reconcileSuggestions(shown, tiny, new Set([key(1)]))).toEqual([key(2)])
  })
})
