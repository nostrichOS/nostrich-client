import { describe, expect, it } from 'vitest'
import type { Hex, NostrEvent } from '@nostrich/nostr'

import { burstCounts, collapseBursts } from './burst'
import { capPerAuthor, onePerAuthor } from './quality'

/** The two rules that decide how much of the screen one account gets. */

const hex = (seed: string): Hex => seed.repeat(32).slice(0, 64) as Hex

const ALICE = hex('aa')
const BOB = hex('bb')
const CAROL = hex('cc')

const MINUTE = 60
const HOUR = 60 * MINUTE

/** Deliberately the middle of a 30-minute bucket (1_800_000_000 is a bucket boundary). */
const NOON = 1_800_000_900

function note(id: string, pubkey: Hex, createdAt: number): NostrEvent {
  return { id, pubkey, created_at: createdAt, kind: 1, tags: [], content: id, sig: '' }
}

const ids = (notes: readonly { id: string }[]): string[] => notes.map(item => item.id)

describe('collapseBursts', () => {
  /** The reported failure, reproduced: fifteen real notes from one verified account. */
  it('reduces a flood to one note without taking anyone else down with it', () => {
    const flood = Array.from({ length: 15 }, (_, index) =>
      note(`alice-${index}`, ALICE, NOON - index * 4),
    )
    const timeline = [...flood.slice(0, 7), note('bob', BOB, NOON - 30), ...flood.slice(7)]

    expect(ids(collapseBursts(timeline))).toEqual(['alice-0', 'bob'])
  })

  /** Relays deliver a window out of order and the feed store appends what arrives. */
  it('represents a burst with its newest note, not the first one it saw', () => {
    const outOfOrder = [
      note('older', ALICE, NOON - 10 * MINUTE),
      note('newest', ALICE, NOON),
      note('middle', ALICE, NOON - 5 * MINUTE),
    ]

    expect(ids(collapseBursts(outOfOrder))).toEqual(['newest'])
  })

  /** Runs after `rankByDistance`, whose output is intentionally not chronological. */
  it('preserves the order it was given and does not touch the caller array', () => {
    const ranked = [
      note('follow-old', ALICE, NOON - 10 * MINUTE),
      note('follow-older', ALICE, NOON - 12 * MINUTE),
      note('stranger-new', BOB, NOON),
      note('friend-mid', CAROL, NOON - 5 * MINUTE),
    ]
    const asGiven = ids(ranked)

    expect(ids(collapseBursts(ranked))).toEqual(['follow-old', 'stranger-new', 'friend-mid'])
    expect(ids(ranked)).toEqual(asGiven)
  })

  /** The whole reason the limit is on density rather than a flat per-feed cap: three. */
  it('lets the same author back in once the window has passed', () => {
    const spread = [
      note('now', ALICE, NOON),
      note('an-hour-ago', ALICE, NOON - HOUR),
      note('yesterday', ALICE, NOON - 24 * HOUR),
    ]

    expect(ids(collapseBursts(spread))).toEqual(['now', 'an-hour-ago', 'yesterday'])
  })

  /** `windowSeconds` is seconds, like `created_at`. */
  it('measures the window in seconds', () => {
    const pair = [note('now', ALICE, NOON), note('five-minutes-ago', ALICE, NOON - 5 * MINUTE)]

    expect(ids(collapseBursts(pair))).toEqual(['now'])
    expect(ids(collapseBursts(pair, { windowSeconds: MINUTE }))).toEqual([
      'now',
      'five-minutes-ago',
    ])
  })

  /** `score` is wired to nothing yet, so nothing else in the app would notice it breaking. */
  it('lets engagement outrank recency, and falls back to recency when scores tie', () => {
    const burst = [note('newest', ALICE, NOON), note('replied-to', ALICE, NOON - MINUTE)]

    expect(ids(collapseBursts(burst, { score: event => (event.id === 'replied-to' ? 9 : 0) })))
      .toEqual(['replied-to'])
    expect(ids(collapseBursts(burst, { score: () => 0 }))).toEqual(['newest'])
  })

  /** `created_at` has one-second resolution, so a thread published in one go arrives. */
  it('leaves a same-second tie with the note the ranking put first', () => {
    const sameSecond = [note('ranked-first', ALICE, NOON), note('ranked-second', ALICE, NOON)]

    expect(ids(collapseBursts(sameSecond))).toEqual(['ranked-first'])
    expect(ids(collapseBursts([...sameSecond].reverse()))).toEqual(['ranked-second'])
  })

  /** This number is rendered as "and N more from this account", which is the honest way. */
  it('counts what it hid, per author, and omits authors it hid nothing from', () => {
    const before = [
      ...Array.from({ length: 15 }, (_, index) => note(`alice-${index}`, ALICE, NOON - index * 4)),
      note('bob', BOB, NOON - 30),
    ]

    const counts = burstCounts(before, collapseBursts(before))

    expect(counts.get(ALICE)).toBe(14)
    expect(counts.has(BOB)).toBe(false)
  })
})

describe('onePerAuthor', () => {
  /** The list arrives newest-first, so first-seen is newest. */
  it('keeps each author newest note and leaves everyone else where they were', () => {
    const results = [
      note('alice-newest', ALICE, NOON),
      note('bob', BOB, NOON - MINUTE),
      note('alice-older', ALICE, NOON - 2 * MINUTE),
      note('carol', CAROL, NOON - 3 * MINUTE),
      note('alice-oldest', ALICE, NOON - 4 * MINUTE),
    ]

    const kept = onePerAuthor(results)

    expect(ids(kept)).toEqual(['alice-newest', 'bob', 'carol'])
    expect(kept[0]?.created_at).toBe(NOON)
  })

  /** Unlike `collapseBursts` this ignores time completely: forty notes over forty. */
  it('collapses an account that owns a whole hashtag page to a single row', () => {
    const monologue = Array.from({ length: 40 }, (_, index) =>
      note(`tagged-${index}`, ALICE, NOON - index * MINUTE),
    )

    expect(ids(onePerAuthor(monologue))).toEqual(['tagged-0'])
  })
})

/** A search that matched nothing reaches both of these before it reaches the empty. */
it('treats an empty timeline as empty rather than an error', () => {
  expect(collapseBursts([])).toEqual([])
  expect(onePerAuthor([])).toEqual([])
})
