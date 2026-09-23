import { describe, expect, it } from 'vitest'
import type { Hex, NostrEvent } from '@nostrich/nostr'

import { peopleFrom } from './explore'

/** Who Explore is willing to recommend. */

const NULPUNT = ('2'.repeat(64)) as Hex
const ORDINARY = 'aa'.repeat(32) as Hex
const ANOTHER = 'bb'.repeat(32) as Hex

function note(id: string, pubkey: Hex): NostrEvent {
  return {
    id,
    pubkey,
    created_at: 1_800_000_000,
    kind: 1,
    tags: [],
    content: 'hello',
    sig: '0'.repeat(128),
  }
}

describe('peopleFrom', () => {
  it('never recommends a blocked account, even when its notes score highest', () => {
    const events = [note('a1', NULPUNT), note('b1', ORDINARY)]
    // Deliberately the top scorer: being popular is exactly how it reached this list.
    const scores = new Map([
      ['a1', 9_999],
      ['b1', 1],
    ])

    const people = peopleFrom(events, scores, 10)

    expect(people.map(person => person.pubkey)).toEqual([ORDINARY])
  })

  it('still ranks everyone else normally', () => {
    const events = [note('a1', ORDINARY), note('a2', ORDINARY), note('b1', ANOTHER)]
    const scores = new Map([
      ['a1', 10],
      ['a2', 10],
      ['b1', 15],
    ])

    const people = peopleFrom(events, scores, 10)

    // Summed, not maxed: two solid notes beat one better one.
    expect(people.map(person => person.pubkey)).toEqual([ORDINARY, ANOTHER])
    expect(people[0]?.notes).toBe(2)
  })

  it('does not let a blocked account consume a slot in the top N', () => {
    // The subtle version of the bug: filtered too late and it still costs a real account.
    const events = [note('a1', NULPUNT), note('b1', ORDINARY), note('c1', ANOTHER)]
    const scores = new Map([
      ['a1', 100],
      ['b1', 50],
      ['c1', 25],
    ])

    const people = peopleFrom(events, scores, 2)

    expect(people.map(person => person.pubkey)).toEqual([ORDINARY, ANOTHER])
  })
})
