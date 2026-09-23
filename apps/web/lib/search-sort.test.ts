import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import { relevanceScore, sortSearch, SEARCH_SORTS } from './search-sort'

const NOW = 1_800_000_000

function note(
  id: string,
  content: string,
  options: { at?: number; tags?: string[][] } = {},
): NostrEvent {
  return {
    id: id.padEnd(64, '0'),
    pubkey: 'a'.repeat(64),
    created_at: options.at ?? NOW,
    kind: 1,
    tags: options.tags ?? [],
    content,
    sig: '0'.repeat(128),
  }
}

/** Relevance, which is the only ranking in the app that a reader can argue. */
describe('relevanceScore', () => {
  it('puts the exact phrase above the same words scattered', () => {
    const together = note('1', 'notes on bitcoin mining in Iceland')
    const apart = note('2', 'bitcoin is interesting, and I also read about mining gold')
    expect(relevanceScore(together, ['bitcoin', 'mining'], NOW)).toBeGreaterThan(
      relevanceScore(apart, ['bitcoin', 'mining'], NOW),
    )
  })

  it('prefers a whole word to the same letters inside another word', () => {
    const whole = note('1', 'this is art, plainly')
    const inside = note('2', 'we will start soon, and restart after')
    expect(relevanceScore(whole, ['art'], NOW)).toBeGreaterThan(
      relevanceScore(inside, ['art'], NOW),
    )
  })

  it('counts a hashtag the author chose as the subject', () => {
    const tagged = note('1', 'a thought', { tags: [['t', 'nostr']] })
    const mentioned = note('2', 'a much longer note that happens to say nostr somewhere in it')
    expect(relevanceScore(tagged, ['nostr'], NOW)).toBeGreaterThan(
      relevanceScore(mentioned, ['nostr'], NOW),
    )
  })

  it('rewards a term the note opens with over one buried at the end', () => {
    const early = note('1', `bitcoin ${'x'.repeat(400)}`)
    const late = note('2', `${'x'.repeat(400)} bitcoin`)
    expect(relevanceScore(early, ['bitcoin'], NOW)).toBeGreaterThan(
      relevanceScore(late, ['bitcoin'], NOW),
    )
  })

  /** Three mentions say something. */
  it('caps repetition', () => {
    const three = note('1', 'nostr nostr nostr')
    const thirty = note('2', Array.from({ length: 30 }, () => 'nostr').join(' '))
    expect(relevanceScore(thirty, ['nostr'], NOW)).toBe(relevanceScore(three, ['nostr'], NOW))
  })

  /** Recency is a tie-break, never a decider. */
  it('lets an older exact match beat a newer incidental one', () => {
    const old = note('1', 'bitcoin mining rigs', { at: NOW - 400 * 86_400 })
    const fresh = note('2', 'mining data, and separately, bitcoin', { at: NOW })
    expect(relevanceScore(old, ['bitcoin', 'mining'], NOW)).toBeGreaterThan(
      relevanceScore(fresh, ['bitcoin', 'mining'], NOW),
    )
  })

  it('scores nothing when nothing was searched for', () => {
    expect(relevanceScore(note('1', 'anything'), [], NOW)).toBe(0)
  })
})

describe('sortSearch', () => {
  const older = note('1', 'bitcoin', { at: NOW - 100 })
  const newer = note('2', 'a note about bitcoin mining and bitcoin', { at: NOW })

  it('defaults to newest first', () => {
    const out = sortSearch([older, newer], 'recent', ['bitcoin'], new Map(), NOW)
    expect(out.map(e => e.id)).toEqual([newer.id, older.id])
  })

  it('does not mutate the list it was given', () => {
    const list = [older, newer]
    sortSearch(list, 'relevance', ['bitcoin'], new Map(), NOW)
    expect(list).toEqual([older, newer])
  })

  it('orders by engagement for `top`, and keeps un-counted notes in time order', () => {
    const counts = new Map([[older.id, { replies: 12, likes: 0, reposts: 0, zapSats: 0 }]])
    const out = sortSearch([older, newer], 'top', ['bitcoin'], counts, NOW)
    // The older note is counted and the newer one is not, so engagement wins.
    expect(out[0]!.id).toBe(older.id)
  })

  /** A sort that changes order between renders makes rows swap under the cursor. */
  it('is stable when every score ties', () => {
    const a = note('a', 'same', { at: NOW })
    const b = note('b', 'same', { at: NOW })
    const first = sortSearch([a, b], 'relevance', ['same'], new Map(), NOW).map(e => e.id)
    const second = sortSearch([b, a], 'relevance', ['same'], new Map(), NOW).map(e => e.id)
    expect(first).toEqual(second)
  })

  it('offers exactly the three sorts the UI knows how to label', () => {
    expect([...SEARCH_SORTS]).toEqual(['recent', 'relevance', 'top'])
  })
})
