import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Hex } from '@nostrich/nostr'

import {
  closeSeedHoles,
  forgetFollowers,
  isSeeded,
  observeFollowers,
  readKnownFollowers,
  retireFalseFollowers,
  isSeedComplete,
  seedKnownFollowers,
  seededAt,
} from './known-followers'

/** The rules that keep "followed you" honest. */

const hex = (seed: string): Hex => seed.repeat(32).slice(0, 64) as Hex

const ME = hex('11')
const ALICE = hex('aa')
const BOB = hex('bb')
const CAROL = hex('cc')

const NOW = 1_800_000_000
const DAY = 24 * 60 * 60

/** What the hook returns, without needing to mount anything to see. */
function stored(viewer: Hex | undefined): Record<string, number> {
  return readKnownFollowers(viewer)
}

const fresh = (pubkey: Hex): { pubkey: Hex; listUpdatedAt: number } => ({
  pubkey,
  listUpdatedAt: NOW - 60,
})
const stale = (pubkey: Hex): { pubkey: Hex; listUpdatedAt: number } => ({
  pubkey,
  listUpdatedAt: NOW - 400 * DAY,
})
/** Published AFTER the seed instant, which is what the announcer requires. */
const after = (pubkey: Hex): { pubkey: Hex; listUpdatedAt: number } => ({
  pubkey,
  listUpdatedAt: NOW + 60,
})

beforeEach(() => {
  localStorage.clear()
  forgetFollowers(ME)
  vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
})

describe('the first run', () => {
  /** The flood, and why it cannot be solved by simply showing new entries. */
  it('records everyone and announces nobody', () => {
    observeFollowers(ME, [fresh(ALICE), fresh(BOB), stale(CAROL)])

    const seen = stored(ME)
    expect(Object.keys(seen).sort()).toEqual([ALICE, BOB, CAROL].sort())
    expect(Object.values(seen)).toEqual([0, 0, 0])
  })

  it('survives a reload', () => {
    observeFollowers(ME, [fresh(ALICE)])
    forgetFollowers(ME) // clears the in-memory copy only…
    localStorage.setItem(
      'nostrich:followers-seen:' + ME,
      JSON.stringify({ [ALICE]: 0 }),
    )
    expect(stored(ME)[ALICE]).toBe(0)
  })
})

describe('after the first run', () => {
  beforeEach(() => {
    // Seeding is what arms the announcer now.
    seedKnownFollowers(ME, [ALICE])
  })

  it('announces somebody genuinely new', () => {
    // Published after the seed instant.
    observeFollowers(ME, [fresh(ALICE), { pubkey: BOB, listUpdatedAt: NOW + 60 }])
    expect(stored(ME)[BOB]).toBe(NOW)
  })

  /** The lie the old logic told. */
  it('does not announce a long-standing follower whose list merely resurfaced', () => {
    observeFollowers(ME, [fresh(ALICE), stale(BOB)])
    expect(stored(ME)[BOB]).toBe(0)
  })

  it('never announces the same person twice', () => {
    observeFollowers(ME, [fresh(ALICE), { pubkey: BOB, listUpdatedAt: NOW + 60 }])
    const first = stored(ME)[BOB]

    vi.spyOn(Date, 'now').mockReturnValue((NOW + 5_000) * 1000)
    observeFollowers(ME, [fresh(ALICE), fresh(BOB)])

    expect(stored(ME)[BOB]).toBe(first)
  })

  /** A follow row has to survive a reload, or it flashes past and is gone. */
  it('keeps the discovery time rather than the list time', () => {
    const published = NOW + 120
    observeFollowers(ME, [{ pubkey: BOB, listUpdatedAt: published }])
    expect(stored(ME)[BOB]).toBe(NOW)
    expect(stored(ME)[BOB]).not.toBe(published)
  })

  it('does not rewrite storage when nothing changed', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem')
    observeFollowers(ME, [fresh(ALICE)])
    expect(write).not.toHaveBeenCalled()
  })
})

describe('isolation between accounts', () => {
  it('keeps one account out of another account list', () => {
    const other = hex('22')
    observeFollowers(ME, [fresh(ALICE)])
    observeFollowers(other, [fresh(BOB)])

    expect(Object.keys(stored(ME))).toEqual([ALICE])
    expect(Object.keys(stored(other))).toEqual([BOB])
  })

  it('reports nothing for a signed-out reader', () => {
    expect(stored(undefined)).toEqual({})
    // And does not throw, or write anything, when asked to observe.
    observeFollowers(undefined, [fresh(ALICE)])
    expect(localStorage.length).toBe(0)
  })
})

describe('storage limits', () => {
  it('evicts only the entries that were never announced', () => {
    // Seeded past the cap, so these all land as zeros.
    const many = Array.from(
      { length: 6_050 },
      (_, index) => index.toString(16).padStart(64, '0') as Hex,
    )
    seedKnownFollowers(ME, many)
    observeFollowers(ME, [
      { pubkey: ALICE, listUpdatedAt: NOW + 60 },
      { pubkey: BOB, listUpdatedAt: NOW + 60 },
    ])

    const seen = stored(ME)
    // The two real follows are still there.
    expect(seen[ALICE]).toBe(NOW)
    expect(seen[BOB]).toBe(NOW)
    expect(Object.keys(seen).length).toBeLessThanOrEqual(6_000 + 2)
  })
})

describe('damaged storage', () => {
  it('treats an unparseable map as a first run rather than throwing', () => {
    localStorage.setItem('nostrich:followers-seen:' + ME, '{not json')
    forgetFollowers(ME)
    localStorage.setItem('nostrich:followers-seen:' + ME, '{not json')

    observeFollowers(ME, [fresh(ALICE)])
    // Seeded silently: a corrupt map must not turn every follower into a notification.
    expect(stored(ME)[ALICE]).toBe(0)
  })

  it('ignores a stored array', () => {
    localStorage.setItem('nostrich:followers-seen:' + ME, '[1,2,3]')
    forgetFollowers(ME)
    localStorage.setItem('nostrich:followers-seen:' + ME, '[1,2,3]')

    observeFollowers(ME, [fresh(ALICE)])
    expect(stored(ME)[ALICE]).toBe(0)
  })
})

/** The wide seed, and the bug it closes. */
describe('seeding', () => {
  it('announces nothing at all until the store has been seeded', () => {
    // A brand-new profile, a genuinely fresh list.
    observeFollowers(ME, [fresh(ALICE)])
    expect(stored(ME)[ALICE]).toBe(0)
    expect(isSeeded(ME)).toBe(false)
  })

  it('records everyone it is seeded with as already-known', () => {
    seedKnownFollowers(ME, [ALICE, BOB])
    expect(stored(ME)[ALICE]).toBe(0)
    expect(stored(ME)[BOB]).toBe(0)
    expect(isSeeded(ME)).toBe(true)
  })

  /** The exact false positive: a long-standing follower who edits their list today. */
  it('does not announce a seeded follower when their list is republished', () => {
    seedKnownFollowers(ME, [ALICE, BOB])
    observeFollowers(ME, [fresh(ALICE), fresh(BOB)])
    expect(stored(ME)[BOB]).toBe(0)
  })

  /** A list published AFTER we started watching is the only thing that can be a new. */
  it('announces a list published after the seed', () => {
    seedKnownFollowers(ME, [ALICE])
    observeFollowers(ME, [{ pubkey: CAROL, listUpdatedAt: NOW + 60 }])
    expect(stored(ME)[CAROL]).toBe(NOW)
  })

  /** The case a snapshot can never cover, and the reason the seed's COMPLETENESS. */
  it('does not announce a follower the seed missed, if their list predates it', () => {
    seedKnownFollowers(ME, [ALICE])
    // Never seeded, list published an hour before we started watching.
    observeFollowers(ME, [{ pubkey: CAROL, listUpdatedAt: NOW - 3_600 }])
    expect(stored(ME)[CAROL]).toBe(0)
  })

  /** An empty result is far more likely to be relays that did not answer than an account. */
  it('refuses to mark itself seeded on an empty result', () => {
    seedKnownFollowers(ME, [])
    expect(isSeeded(ME)).toBe(false)
    observeFollowers(ME, [fresh(ALICE)])
    expect(stored(ME)[ALICE]).toBe(0)
  })

  it('clears the marker on reset, so a reset cannot cause the flood', () => {
    seedKnownFollowers(ME, [ALICE])
    expect(isSeeded(ME)).toBe(true)
    forgetFollowers(ME)
    expect(isSeeded(ME)).toBe(false)
  })
})

/** The reported case, in one block. */
describe('verifying against an earlier list', () => {
  beforeEach(() => {
    seedKnownFollowers(ME, [CAROL])
  })

  it('never announces somebody whose earlier list already named the reader', () => {
    observeFollowers(ME, [after(ALICE)], new Set([ALICE]))
    expect(stored(ME)[ALICE]).toBe(0)
  })

  it('still announces somebody whose earlier list did not name them', () => {
    observeFollowers(ME, [after(ALICE)], new Set([BOB]))
    expect(stored(ME)[ALICE]).toBe(NOW)
  })

  /** No older copy on any relay is no evidence, and the answer there is the old behaviour. */
  it('announces when there is nothing to verify against', () => {
    observeFollowers(ME, [after(ALICE)], new Set())
    expect(stored(ME)[ALICE]).toBe(NOW)
  })

  it('cannot resurrect somebody already filed as known', () => {
    observeFollowers(ME, [stale(ALICE)])
    expect(stored(ME)[ALICE]).toBe(0)
    observeFollowers(ME, [after(ALICE)], new Set())
    expect(stored(ME)[ALICE]).toBe(0)
  })
})

describe('retiring an announcement that turned out to be wrong', () => {
  beforeEach(() => {
    seedKnownFollowers(ME, [CAROL])
  })

  it('re-files an announced follower whose earlier list already named the reader', () => {
    observeFollowers(ME, [after(ALICE)], new Set())
    expect(stored(ME)[ALICE]).toBe(NOW)
    retireFalseFollowers(ME, new Set([ALICE]))
    expect(stored(ME)[ALICE]).toBe(0)
  })

  it('only ever moves announced to known, never the other way', () => {
    observeFollowers(ME, [stale(BOB)])
    retireFalseFollowers(ME, new Set([BOB]))
    expect(stored(ME)[BOB]).toBe(0)
  })

  it('leaves people it was not asked about alone', () => {
    observeFollowers(ME, [after(ALICE)], new Set())
    retireFalseFollowers(ME, new Set([BOB]))
    expect(stored(ME)[ALICE]).toBe(NOW)
  })
})

/** A second seed closes holes and must not do anything else. */
describe('closing holes a later seed finds', () => {
  it('records a missed follower as already-known', () => {
    seedKnownFollowers(ME, [CAROL])
    closeSeedHoles(ME, [ALICE])
    expect(stored(ME)[ALICE]).toBe(0)
  })

  it('does not move the start line', () => {
    seedKnownFollowers(ME, [CAROL])
    const started = seededAt(ME)
    closeSeedHoles(ME, [ALICE])
    expect(seededAt(ME)).toBe(started)
  })

  it('never overwrites an announcement already made', () => {
    seedKnownFollowers(ME, [CAROL])
    observeFollowers(ME, [after(ALICE)], new Set())
    expect(stored(ME)[ALICE]).toBe(NOW)
    closeSeedHoles(ME, [ALICE])
    expect(stored(ME)[ALICE]).toBe(NOW)
  })
})

describe('a seed that could not see everyone', () => {
  /** THE REPORTED BUG, in one test. */
  it('does not announce an unknown author when the seed hit its ceiling', () => {
    seedKnownFollowers(ME, [ALICE], false)
    expect(isSeedComplete(ME)).toBe(false)

    // BOB was following all along.
    observeFollowers(ME, [after(BOB)])
    expect(stored(ME)[BOB]).toBe(0)
  })

  it('still announces one PROVEN new, even from an incomplete seed', () => {
    seedKnownFollowers(ME, [ALICE], false)
    // CAROL's own earlier list was retrievable and did not name the reader.
    observeFollowers(ME, [after(CAROL)], new Set(), new Set([CAROL]))
    expect(stored(ME)[CAROL]).toBe(NOW)
  })

  it('keeps announcing on absence when the seed WAS complete', () => {
    // A small account whose whole follower set fits under the ceiling.
    seedKnownFollowers(ME, [ALICE], true)
    expect(isSeedComplete(ME)).toBe(true)
    observeFollowers(ME, [after(BOB)])
    expect(stored(ME)[BOB]).toBe(NOW)
  })

  it('defaults to complete, so an old store behaves as it did', () => {
    seedKnownFollowers(ME, [ALICE])
    expect(isSeedComplete(ME)).toBe(true)
  })
})
