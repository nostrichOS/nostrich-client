import { beforeEach, describe, expect, it } from 'vitest'

import { forgetFirstSeen, observeFirstSeen, readFirstSeen } from './first-seen'

/** The incident this file exists to prevent, twice. */

const VIEWER = 'v'.repeat(64)
const NS = 'test-bucket'
const DAY = 86_400
const now = () => Math.floor(Date.now() / 1000)
const options = { max: 100, freshWithin: 3 * DAY }

/** A fresh bucket for every case. */
beforeEach(() => {
  localStorage.clear()
  forgetFirstSeen(NS, VIEWER)
})

describe('observeFirstSeen', () => {
  it('announces nothing on the run that starts the clock', () => {
    observeFirstSeen(NS, VIEWER, [{ key: 'a', writtenAt: now() }], options)
    // Recorded as "already here".
    expect(readFirstSeen(NS, VIEWER)).toEqual({ a: 0 })
  })

  it('announces an entry whose list was published after watching began', () => {
    observeFirstSeen(NS, VIEWER, [], options)
    observeFirstSeen(NS, VIEWER, [{ key: 'a', writtenAt: now() + 5 }], options)
    expect(readFirstSeen(NS, VIEWER).a).toBeGreaterThan(0)
  })

  /** The load-bearing clause: older than the start line means it was already there. */
  it('never announces a list older than the moment watching began', () => {
    observeFirstSeen(NS, VIEWER, [], options)
    observeFirstSeen(NS, VIEWER, [{ key: 'a', writtenAt: now() - 60 }], options)
    expect(readFirstSeen(NS, VIEWER)).toEqual({ a: 0 })
  })

  it('does not announce something published after the start line but long ago', () => {
    // Impossible in practice, and the freshness gate is what makes it impossible.
    observeFirstSeen(NS, VIEWER, [], options)
    observeFirstSeen(NS, VIEWER, [{ key: 'a', writtenAt: now() - 30 * DAY }], options)
    expect(readFirstSeen(NS, VIEWER)).toEqual({ a: 0 })
  })

  /** THE REGRESSION, in one case: the same store, shown a much larger set the second time. */
  it('files newly-visible old entries as known when the window widens', () => {
    observeFirstSeen(NS, VIEWER, [{ key: 'seen-already', writtenAt: now() }], options)
    observeFirstSeen(NS, VIEWER, [], options)

    const widened = Array.from({ length: 20 }, (_, i) => ({
      key: `old-${i}`,
      // Their lists were republished moments ago, which is what made them look fresh.
      writtenAt: now(),
      }))
    observeFirstSeen(NS, VIEWER, widened, options)

    const seen = readFirstSeen(NS, VIEWER)
    expect(Object.keys(seen)).toHaveLength(21)
    expect(Object.values(seen).every(at => at === 0)).toBe(true)
  })

  it('does not change a verdict it has already reached', () => {
    observeFirstSeen(NS, VIEWER, [], options)
    observeFirstSeen(NS, VIEWER, [{ key: 'a', writtenAt: now() + 5 }], options)
    const announcedAt = readFirstSeen(NS, VIEWER).a
    observeFirstSeen(NS, VIEWER, [{ key: 'a', writtenAt: now() + 500 }], options)
    expect(readFirstSeen(NS, VIEWER).a).toBe(announcedAt)
  })

  it('runs repeatedly in one page load without turning arrivals into news', () => {
    // `observeFirstSeen` is called on every pass of a query as data arrives.
    for (let pass = 0; pass < 5; pass += 1) {
      observeFirstSeen(NS, VIEWER, [{ key: `k-${pass}`, writtenAt: now() }], options)
    }
    expect(Object.values(readFirstSeen(NS, VIEWER)).every(at => at === 0)).toBe(true)
  })

  it('keeps the announced ones when it prunes', () => {
    observeFirstSeen(NS, VIEWER, [], options)
    observeFirstSeen(NS, VIEWER, [{ key: 'news', writtenAt: now() + 5 }], options)
    const filler = Array.from({ length: 200 }, (_, i) => ({ key: `f-${i}`, writtenAt: now() - DAY }))
    observeFirstSeen(NS, VIEWER, filler, { max: 20, freshWithin: 3 * DAY })

    const seen = readFirstSeen(NS, VIEWER)
    // The zeros are what gets evicted.
    expect(seen['news']).toBeGreaterThan(0)
    expect(Object.keys(seen).length).toBeLessThanOrEqual(21)
  })

  it('does nothing at all without a viewer', () => {
    observeFirstSeen(NS, undefined, [{ key: 'a', writtenAt: now() }], options)
    expect(readFirstSeen(NS, undefined)).toEqual({})
  })
})
