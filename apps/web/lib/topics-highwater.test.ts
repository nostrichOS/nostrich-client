import { describe, expect, it } from 'vitest'

import { bestTopics } from './explore'

/** Reported: "What's happening shows only 4 hashtags, and this morning for a few. */
const topic = (tag: string) => ({ tag, notes: 10, atLeast: false, score: 2 })
const ten = Array.from({ length: 10 }, (_, i) => topic('t' + i))
const four = Array.from({ length: 4 }, (_, i) => topic('t' + i))
const TTL = 300_000
const NOW = 1_000_000

describe('bestTopics', () => {
  it('keeps the fuller list when a thin sample comes back', () => {
    expect(bestTopics(four, { at: NOW - 1_000, topics: ten }, TTL, NOW)).toHaveLength(10)
  })

  it('takes the new list when it is at least as full', () => {
    expect(bestTopics(ten, { at: NOW - 1_000, topics: four }, TTL, NOW)).toBe(ten)
  })

  it('lets a genuinely smaller list through once the held one is properly old', () => {
    // Otherwise a quiet week could never be reported, only outvoted by a stale good day.
    expect(bestTopics(four, { at: NOW - TTL * 7, topics: ten }, TTL, NOW)).toBe(four)
  })

  it('has nothing to defend on a first run', () => {
    expect(bestTopics(four, undefined, TTL, NOW)).toBe(four)
  })

  it('never treats an empty held list as something worth keeping', () => {
    expect(bestTopics(four, { at: NOW, topics: [] }, TTL, NOW)).toBe(four)
  })

  it('returns the SAME array when the fresh answer wins, so the caller can tell', () => {
    // The caller writes the cache only on identity, which is what stops a held list.
    const result = bestTopics(ten, { at: NOW, topics: four }, TTL, NOW)
    expect(result).toBe(ten)
    expect(bestTopics(four, { at: NOW, topics: ten }, TTL, NOW)).not.toBe(four)
  })
})

describe('bestTopics past the TTL', () => {
  /** The reported symptom: ten rows, then seven, then six, then ten again, inside a few. */
  const EXPIRED = { at: NOW - TTL - 1, topics: ten }

  it('tops a thin expired draw back up to the count that was on screen', () => {
    const result = bestTopics(four, EXPIRED, TTL, NOW)
    expect(result).toHaveLength(10)
  })

  it('leads with the new draw and only borrows below it', () => {
    const result = bestTopics(four, EXPIRED, TTL, NOW)
    expect(result.slice(0, four.length)).toEqual(four)
  })

  it('never repeats a tag the new draw already found', () => {
    const result = bestTopics(four, EXPIRED, TTL, NOW)
    expect(new Set(result.map(t => t.tag)).size).toBe(result.length)
  })

  it('still lets a full fresh draw replace the held list outright', () => {
    // Topping up must not turn into never letting the list change.
    expect(bestTopics(ten, EXPIRED, TTL, NOW)).toBe(ten)
  })
})
