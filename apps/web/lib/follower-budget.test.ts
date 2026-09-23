import { beforeEach, describe, expect, it } from 'vitest'
import type { Hex } from '@nostrich/nostr'

import {
  demoteSeedCompleteness,
  recordServerFollowers,
  forgetFollowers,
  isSeedComplete,
  noteFollowerCount,
  observeFollowers,
  readKnownFollowers,
  seedKnownFollowers,
} from './known-followers'

/** Reported: "is notifications page missing all follower notifications. */
const ME = 'f'.repeat(64) as Hex
const A = 'a'.repeat(64) as Hex
const B = 'b'.repeat(64) as Hex
const C = 'c'.repeat(64) as Hex
const now = () => Math.floor(Date.now() / 1000)

const KEYS = [
  'nostrich:follower-count:', 'nostrich:follower-mark:', 'nostrich:follower-mark-at:',
  'nostrich:follower-budget:', 'nostrich:follower-source:', 'nostrich:followers-seen:',
  'nostrich:followers-seeded:', 'nostrich:followers-complete:',
]
function reset(): void {
  // The module holds an in-memory copy as well as the stored one.
  forgetFollowers(ME)
  for (const key of KEYS) localStorage.removeItem(key + ME)
}
/** Seeded, but INCOMPLETE. */
function seedIncomplete(alsoKnown: Hex[] = []): void {
  // One call: `seedKnownFollowers` is gated on `isSeeded`, so a second one is a no-op.
  seedKnownFollowers(ME, [A, ...alsoKnown], false)
  /* Backdated a day. */
  localStorage.setItem('nostrich:followers-seeded:' + ME, String(now() - 24 * 3600))
}
const list = (pubkey: Hex, ageSeconds = 30) => ({ pubkey, listUpdatedAt: now() - ageSeconds })

/** Establish a number that may be BELIEVED. */
function settleAt(count: number, source: 'index' | 'relay' = 'index'): void {
  noteFollowerCount(ME, count, source)
  localStorage.setItem('nostrich:follower-mark-at:' + ME, String(Date.now() - 10 * 60_000))
  noteFollowerCount(ME, count, source)
}

describe('follower announcements licensed by the count', () => {
  beforeEach(reset)

  it('announces nothing on the FIRST count, there is no growth to have seen', () => {
    seedIncomplete()
    noteFollowerCount(ME, 3_277, 'index')
    observeFollowers(ME, [list(B)])
    expect(readKnownFollowers(ME)[B]).toBe(0)
  })

  it('announces a new follower once the count has actually grown', () => {
    seedIncomplete()
    settleAt(3_277)
    settleAt(3_278)
    observeFollowers(ME, [list(B)])
    expect(readKnownFollowers(ME)[B]).toBeGreaterThan(0)
  })

  it('announces no more people than the count grew by, freshest list first', () => {
    seedIncomplete()
    settleAt(100)
    settleAt(101)
    observeFollowers(ME, [list(B, 10), list(C, 20)])
    const seen = readKnownFollowers(ME)
    expect([seen[B], seen[C]].filter(at => (at ?? 0) > 0)).toHaveLength(1)
    expect(seen[B]).toBeGreaterThan(0)
  })

  it('announces nobody when the count did not move, a list edit is not a follow', () => {
    // The failure the whole mechanism exists to prevent: following ANYBODY republishes.
    seedIncomplete()
    settleAt(100)
    noteFollowerCount(ME, 100, 'index')
    observeFollowers(ME, [list(B)])
    expect(readKnownFollowers(ME)[B]).toBe(0)
  })

  it('announces nobody when the count went DOWN', () => {
    seedIncomplete()
    settleAt(100)
    noteFollowerCount(ME, 98, 'index')
    observeFollowers(ME, [list(B)])
    expect(readKnownFollowers(ME)[B]).toBe(0)
  })

  it('does not let an unfollow leave a debt that swallows the next real follower', () => {
    seedIncomplete()
    settleAt(100)
    noteFollowerCount(ME, 98, 'index')
    settleAt(99)
    observeFollowers(ME, [list(B)])
    expect(readKnownFollowers(ME)[B]).toBeGreaterThan(0)
  })

  it('spends the budget only ONCE, however many times the lists arrive', () => {
    seedIncomplete()
    settleAt(100)
    settleAt(101)
    observeFollowers(ME, [list(B)])
    observeFollowers(ME, [list(C)])
    expect(readKnownFollowers(ME)[C]).toBe(0)
  })

  it('caps a single jump, so an index catching up cannot announce a flood', () => {
    seedIncomplete()
    settleAt(100)
    settleAt(5_000)
    const many = Array.from({ length: 40 }, (_, i) => list(String(i).padStart(64, '0') as Hex, i))
    observeFollowers(ME, many)
    expect(Object.values(readKnownFollowers(ME)).filter(at => at > 0).length).toBeLessThanOrEqual(10)
  })

  it('never announces a list that predates us watching, budget or no budget', () => {
    seedIncomplete()
    settleAt(100)
    settleAt(110)
    observeFollowers(ME, [{ pubkey: B, listUpdatedAt: now() - 14 * 24 * 3600 }])
    expect(readKnownFollowers(ME)[B]).toBe(0)
  })

  it('still declines to announce somebody proven to have been following already', () => {
    seedIncomplete()
    settleAt(100)
    settleAt(101)
    observeFollowers(ME, [list(B)], new Set([B]))
    expect(readKnownFollowers(ME)[B]).toBe(0)
  })
})

describe('settling is a question of time, not repetition', () => {
  beforeEach(reset)

  it('does not settle on the same number arriving twice in one page load', () => {
    seedIncomplete()
    noteFollowerCount(ME, 46, 'index')
    noteFollowerCount(ME, 46, 'index')
    noteFollowerCount(ME, 46, 'index')
    noteFollowerCount(ME, 68, 'index')
    observeFollowers(ME, [list(B)])
    expect(readKnownFollowers(ME)[B]).toBe(0)
  })

  it('banks nothing while the number is still climbing on its own', () => {
    seedIncomplete()
    noteFollowerCount(ME, 46, 'index')
    noteFollowerCount(ME, 68, 'index')
    observeFollowers(ME, [list(B)])
    expect(readKnownFollowers(ME)[B]).toBe(0)
  })
})

describe('the two counts are never subtracted from each other', () => {
  beforeEach(reset)

  it('re-baselines when the source changes instead of banking the difference', () => {
    // Measured on a real account: the index says 3,282 where our own relays say 2,426.
    seedIncomplete()
    settleAt(2_426, 'relay')
    settleAt(3_282, 'index')
    observeFollowers(ME, [list(B)])
    expect(readKnownFollowers(ME)[B]).toBe(0)
  })

  it('announces once the NEW source has grown on its own terms', () => {
    seedIncomplete()
    settleAt(2_426, 'relay')
    settleAt(3_282, 'index')
    settleAt(3_283, 'index')
    observeFollowers(ME, [list(B)])
    expect(readKnownFollowers(ME)[B]).toBeGreaterThan(0)
  })
})

/** Whether the seed is entitled to say it saw everybody. */
describe('demoteSeedCompleteness', () => {
  beforeEach(reset)

  it('withdraws the claim when the count knows about more than arrived', () => {
    seedKnownFollowers(ME, [A], true)
    expect(isSeedComplete(ME)).toBe(true)
    demoteSeedCompleteness(ME, 1_763, 13_152)
    expect(isSeedComplete(ME)).toBe(false)
  })

  it('leaves a genuinely complete seed alone', () => {
    seedKnownFollowers(ME, [A], true)
    demoteSeedCompleteness(ME, 69, 68)
    expect(isSeedComplete(ME)).toBe(true)
  })

  it('does nothing when no relay could answer COUNT', () => {
    seedKnownFollowers(ME, [A], true)
    demoteSeedCompleteness(ME, 69, undefined)
    expect(isSeedComplete(ME)).toBe(true)
  })

  it('NEVER upgrades, a low count must not buy a claim the seed did not earn', () => {
    seedKnownFollowers(ME, [A], false)
    demoteSeedCompleteness(ME, 5_000, 10)
    expect(isSeedComplete(ME)).toBe(false)
  })
})

/** A re-follow by somebody already on file, which is what an unfollow-then-refollow. */
describe('someone already on file', () => {
  beforeEach(reset)

  it('is never announced again, however the count moves', () => {
    // Recorded as known.
    seedIncomplete([B])
    settleAt(100)
    settleAt(101)
    observeFollowers(ME, [list(B)])
    expect(readKnownFollowers(ME)[B]).toBe(0)
  })

  it('leaves the licence unspent for somebody genuinely new', () => {
    // The budget must not be burned on a candidate that was skipped before any rule ran.
    seedIncomplete([B])
    settleAt(100)
    settleAt(101)
    observeFollowers(ME, [list(B, 5), list(C, 10)])
    expect(readKnownFollowers(ME)[C]).toBeGreaterThan(0)
  })
})

/** Follows our own server established, recorded where every surface reads them. */
describe('recordServerFollowers', () => {
  beforeEach(reset)

  it('records a server-established follow so the dot can count it', () => {
    recordServerFollowers(ME, [{ pubkey: B, at: 5_000 }])
    expect(readKnownFollowers(ME)[B]).toBe(5_000)
  })

  it("uses the SERVER's timestamp, not the moment this browser asked", () => {
    // The server was watching continuously.
    recordServerFollowers(ME, [{ pubkey: B, at: 1_234 }])
    expect(readKnownFollowers(ME)[B]).toBe(1_234)
  })

  it('never re-dates an entry already counted', () => {
    // Moving it forward would light the dot a second time for one follow.
    recordServerFollowers(ME, [{ pubkey: B, at: 1_000 }])
    recordServerFollowers(ME, [{ pubkey: B, at: 9_999 }])
    expect(readKnownFollowers(ME)[B]).toBe(1_000)
  })

  it('does not overwrite somebody already known NOT to be news', () => {
    // Seeded as 0 means they were following when we started.
    seedIncomplete([B])
    recordServerFollowers(ME, [{ pubkey: B, at: 9_999 }])
    expect(readKnownFollowers(ME)[B]).toBe(0)
  })

  it('stops observeFollowers announcing the same person twice', () => {
    seedIncomplete()
    recordServerFollowers(ME, [{ pubkey: C, at: 7_000 }])
    settleAt(100)
    settleAt(101)
    observeFollowers(ME, [list(C)])
    // Still the server's timestamp.
    expect(readKnownFollowers(ME)[C]).toBe(7_000)
  })
})
