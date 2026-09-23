import { describe, expect, it } from 'vitest'
import type { Hex, NostrEvent } from '@nostrich/nostr'

import { MIN_AUTHORS, MIN_LENGTH, findDuplicates, normalize } from './duplicates'

/** Cross-author duplicate detection. */

const key = (i: number): Hex => (i + 16).toString(16).padStart(2, '0').repeat(32) as Hex

/** Comfortably over MIN_LENGTH once normalized. */
const LONG =
  'this is a long enough piece of writing that repeating it verbatim across several unrelated accounts means something is coordinating them'

let seq = 0
function note(pubkey: Hex, content: string, createdAt?: number): NostrEvent {
  seq += 1
  return {
    id: seq.toString(16).padStart(64, '0'),
    pubkey,
    created_at: createdAt ?? 1_800_000_000 + seq,
    kind: 1,
    tags: [],
    content,
    sig: '0'.repeat(128),
  }
}

describe('normalize', () => {
  it('strips the payload URL, which is the thing a ring varies', () => {
    const a = normalize('Check this out https://spam.example/a1')
    const b = normalize('Check this out https://spam.example/b2')
    expect(a).toBe(b)
  })

  it('is unmoved by case, emoji and punctuation padding', () => {
    expect(normalize('Buy NOW!!! 🔥🔥')).toBe(normalize('buy now 🚀'.replace('🚀', '')).trim())
    expect(normalize('Hello, World.')).toBe('hello world')
  })

  it('drops hashtags and nostr entities', () => {
    expect(normalize('gm #bitcoin nostr:npub1abc')).toBe('gm')
  })
})

describe('findDuplicates', () => {
  it('folds every copy after the earliest once enough accounts post it', () => {
    const events = [
      note(key(1), LONG, 300),
      note(key(2), LONG, 200),
      note(key(3), LONG, 100),
    ]
    const collapse = findDuplicates(events)

    // The EARLIEST survives.
    expect(collapse.has(events[2]!.id)).toBe(false)
    expect(collapse.has(events[0]!.id)).toBe(true)
    expect(collapse.has(events[1]!.id)).toBe(true)
    expect(collapse.get(events[0]!.id)).toBe(3)
  })

  it('leaves two accounts alone, that is an alt or a crosspost, not a ring', () => {
    const events = [note(key(1), LONG), note(key(2), LONG)]
    expect(findDuplicates(events).size).toBe(0)
  })

  it('never counts one author repeating themselves as a ring', () => {
    // A different problem entirely, and the one a relay policy already solves.
    const events = Array.from({ length: 10 }, () => note(key(1), LONG))
    expect(findDuplicates(events).size).toBe(0)
  })

  it('ignores short text however many people say it', () => {
    // "gm" came from sixteen distinct accounts in one real sample.
    const events = Array.from({ length: 20 }, (_, i) => note(key(i), 'gm'))
    expect(findDuplicates(events).size).toBe(0)
  })

  it('ignores the mempool bot fleet, the measured false positive', () => {
    // 85 normalized chars from a handful of fixed pubkeys.
    const block = 'block 963304 2 high priority 2 medium priority 1 low priority 1 no priority 1 purging'
    expect(normalize(block).length).toBeLessThan(MIN_LENGTH)
    const events = Array.from({ length: 5 }, (_, i) => note(key(i), block))
    expect(findDuplicates(events).size).toBe(0)
  })

  it('ignores image-only posts, which all normalize to nothing', () => {
    // The largest "ring" in two of three real samples: 43 distinct authors, every one.
    const events = Array.from({ length: 40 }, (_, i) =>
      note(key(i), 'https://media.example/photo.jpg'),
    )
    expect(findDuplicates(events).size).toBe(0)
  })

  it('exempts reposts, which are meant to be identical', () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      ...note(key(i), LONG),
      kind: 6,
    }))
    expect(findDuplicates(events).size).toBe(0)
  })

  it('never folds an exempt author, though they still count toward the ring', () => {
    const FRIEND = key(9)
    const events = [
      note(key(1), LONG, 100),
      note(key(2), LONG, 200),
      note(FRIEND, LONG, 300),
    ]
    const collapse = findDuplicates(events, { exempt: pubkey => pubkey === FRIEND })

    expect(collapse.has(events[2]!.id)).toBe(false)
    // Their copy is still evidence the text is circulating, so the ring is intact.
    expect(collapse.get(events[1]!.id)).toBe(MIN_AUTHORS)
  })

  it('keeps unrelated texts in separate buckets', () => {
    const other = `${LONG} but ending differently`
    const events = [
      note(key(1), LONG),
      note(key(2), LONG),
      note(key(3), other),
      note(key(4), other),
    ]
    // Neither group reaches three authors.
    expect(findDuplicates(events).size).toBe(0)
  })

  it('catches a ring that varies only its link', () => {
    // The real evasion: identical pitch, different payload URL per copy.
    const events = [1, 2, 3].map(i => note(key(i), `${LONG} https://spam.example/${i}`))
    expect(findDuplicates(events).size).toBe(2)
  })
})
