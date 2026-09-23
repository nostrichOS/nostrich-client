import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { withinBudget, CACHE_MAX_BYTES } from './notifications'
import type { NostrEvent } from '@nostrich/nostr'

/** The notifications cache was capped by COUNT and not by size, and a count. */
const event = (createdAt: number, size: number): NostrEvent =>
  ({
    id: String(createdAt).padStart(64, '0'),
    kind: 1,
    pubkey: 'a'.repeat(64),
    created_at: createdAt,
    content: 'x'.repeat(size),
    tags: [],
    sig: '0'.repeat(128),
  }) as NostrEvent

/** Newest first, which is how the cache is written. */
const newestFirst = (count: number, size: number): NostrEvent[] =>
  Array.from({ length: count }, (_, i) => event(10_000 - i, size))

describe('withinBudget', () => {
  it('leaves a small cache alone', () => {
    const small = newestFirst(10, 100)
    expect(withinBudget(small)).toHaveLength(10)
  })

  it('brings a fat cache under the budget', () => {
    const fat = newestFirst(300, 8_000)
    const kept = withinBudget(fat)
    expect(JSON.stringify(kept).length * 2).toBeLessThanOrEqual(CACHE_MAX_BYTES)
  })

  it('KEEPS THE NEWEST, which is the whole point of the cache', () => {
    // The bug this test exists for: the list is newest-first, so trimming the front would.
    const fat = newestFirst(300, 8_000)
    const kept = withinBudget(fat)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept[0]?.created_at).toBe(10_000)
    expect(kept.at(-1)?.created_at).toBeGreaterThan(10_000 - 300)
  })

  it('stays in descending order', () => {
    const kept = withinBudget(newestFirst(300, 8_000))
    for (let i = 1; i < kept.length; i++) {
      expect(kept[i - 1]!.created_at).toBeGreaterThan(kept[i]!.created_at)
    }
  })

  it('still returns something when a single event is enormous', () => {
    // Better one oversized row than an empty page.
    const kept = withinBudget([event(1, 900_000)])
    expect(kept.length).toBeLessThanOrEqual(1)
  })

  it('handles an empty list', () => {
    expect(withinBudget([])).toEqual([])
  })
})

