import { describe, expect, it } from 'vitest'

import { topicsTtlMs } from './explore'

/** The cadence the trending panel refreshes at, per window. */
describe('topicsTtlMs', () => {
  it('matches the chosen cadence at each window the UI offers', () => {
    expect(topicsTtlMs(1)).toBe(5 * 60_000)
    expect(topicsTtlMs(4)).toBe(15 * 60_000)
    expect(topicsTtlMs(24)).toBe(30 * 60_000)
  })

  it('clamps rather than scaling without bound', () => {
    // A very short window must not refetch a thousand-note sample every few seconds.
    expect(topicsTtlMs(0.25)).toBe(5 * 60_000)
    // A very long one must not go stale for hours.
    expect(topicsTtlMs(24 * 7)).toBe(30 * 60_000)
  })

  it('rises with the window between the clamps', () => {
    expect(topicsTtlMs(6)).toBeGreaterThan(topicsTtlMs(4))
    expect(topicsTtlMs(12)).toBeGreaterThan(topicsTtlMs(6))
  })
})
