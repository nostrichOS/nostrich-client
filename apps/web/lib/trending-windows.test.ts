import { describe, expect, it } from 'vitest'

import { claimedByShorterWindow, type TrendingWindowIds } from './trending'
import { onePerAuthor } from './quality'
import type { Hex } from '@nostrich/nostr'

/** The two trending rules, pinned. */

const NOW = 1_700_000_000
const HOUR = 3_600

function id(seed: string): Hex {
  return seed.padEnd(64, '0') as Hex
}

/** Array order is the ranking, exactly as the index returns. */
function windows(spec: Record<number, string[]>): TrendingWindowIds[] {
  return Object.entries(spec).map(([hours, ids]) => ({
    hours: Number(hours),
    ids: new Set(ids.map(id)),
    ranks: new Map(ids.map((seed, index) => [id(seed), index])),
  }))
}

describe('claimedByShorterWindow', () => {
  it('claims a note that a shorter window both indexes and would display', () => {
    const note = { id: id('a'), created_at: NOW - 10 * 60 }
    expect(claimedByShorterWindow(note, windows({ 1: ['a'] }), NOW)).toBe(true)
  })

  it('leaves a note alone when no shorter window indexes it', () => {
    const note = { id: id('a'), created_at: NOW - 10 * 60 }
    expect(claimedByShorterWindow(note, windows({ 1: ['b'] }), NOW)).toBe(false)
  })

  /** The case the age test exists for, and the one that would otherwise lose notes. */
  it('does not let a window claim a note it is too old for', () => {
    const old = { id: id('a'), created_at: NOW - 6 * HOUR }
    expect(claimedByShorterWindow(old, windows({ 1: ['a'] }), NOW)).toBe(false)
    // …and the 4h window, which CAN show it, still can.
    expect(claimedByShorterWindow(old, windows({ 1: ['a'], 4: ['a'] }), NOW)).toBe(false)
  })

  it('claims from the shortest window that can actually show it', () => {
    const note = { id: id('a'), created_at: NOW - 2 * HOUR }
    // Too old for 1h, in range for 4h.
    expect(claimedByShorterWindow(note, windows({ 1: ['a'], 4: ['a'] }), NOW)).toBe(true)
  })

  /** No shorter window exists for the fastest tab, so it can never lose a note. */
  it('claims nothing when there are no shorter windows', () => {
    const note = { id: id('a'), created_at: NOW - 10 * 60 }
    expect(claimedByShorterWindow(note, [], NOW)).toBe(false)
  })

  /** The index being unreachable must degrade to duplicates, never to an empty tab. */
  it('treats a failed fetch as no claim at all', () => {
    const note = { id: id('a'), created_at: NOW - 10 * 60 }
    expect(claimedByShorterWindow(note, windows({ 1: [] }), NOW)).toBe(false)
  })
})

describe('one note per author, on a ranked list', () => {
  it('keeps each author once, at their best-ranked note', () => {
    const ranked = [
      { id: id('a1'), pubkey: id('alice') },
      { id: id('b1'), pubkey: id('bob') },
      { id: id('a2'), pubkey: id('alice') },
      { id: id('a3'), pubkey: id('alice') },
    ]
    expect(onePerAuthor(ranked).map(note => note.id)).toEqual([id('a1'), id('b1')])
  })

  it('does not drop distinct authors', () => {
    const ranked = [
      { id: id('a1'), pubkey: id('alice') },
      { id: id('b1'), pubkey: id('bob') },
      { id: id('c1'), pubkey: id('carol') },
    ]
    expect(onePerAuthor(ranked)).toHaveLength(3)
  })
})

/** The rank rule, and the hole it closes. */
describe('the window with the best claim', () => {
  const note = { id: id('a'), created_at: NOW - 10 * 60 }

  it('does not surrender a note to a window that ranks it lower', () => {
    // 25th over the hour, 10th here.
    const shorter = windows({ 1: [...Array.from({ length: 25 }, (_, i) => `x${i}`), 'a'] })
    expect(claimedByShorterWindow(note, shorter, NOW, 10)).toBe(false)
  })

  it('surrenders a note to a window that ranks it higher', () => {
    // 1st over the hour, 40th here: breaking news, and the hour is where it belongs.
    const shorter = windows({ 1: ['a', 'x1', 'x2'] })
    expect(claimedByShorterWindow(note, shorter, NOW, 40)).toBe(true)
  })

  /** A tie goes to the shorter window, or "happening right now" slowly empties out. */
  it('gives an equal placement to the shorter window', () => {
    const shorter = windows({ 1: ['x0', 'x1', 'a'] })
    expect(claimedByShorterWindow(note, shorter, NOW, 2)).toBe(true)
  })

  it('still refuses a window the note is too old for, however well it ranks there', () => {
    const old = { id: id('a'), created_at: NOW - 6 * HOUR }
    const shorter = windows({ 1: ['a'] })
    expect(claimedByShorterWindow(old, shorter, NOW, 99)).toBe(false)
  })

  /** Two shorter windows: any one of them ranking it higher is enough to take. */
  it('takes the note if any shorter window ranks it higher', () => {
    const shorter = windows({ 1: ['x0', 'x1', 'x2', 'a'], 4: ['a'] })
    expect(claimedByShorterWindow(note, shorter, NOW, 2)).toBe(true)
  })

  it('falls back to presence alone when no rank is given', () => {
    const shorter = windows({ 1: [...Array.from({ length: 25 }, (_, i) => `x${i}`), 'a'] })
    expect(claimedByShorterWindow(note, shorter, NOW)).toBe(true)
  })
})
