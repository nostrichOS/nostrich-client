import { describe, expect, it } from 'vitest'

/** Whether a fresh answer may empty a panel that already has rows. */
/** The shipped rule: a shorter answer is kept back while the list on screen is still. */
const resolve = (fresh: number, held: number, stale = false): number => {
  if (fresh < held && !stale) return held
  return fresh > 0 ? fresh : held
}

describe('an empty answer never replaces a list we have', () => {
  it('keeps the rows when the index answers with nothing', () => {
    // "The index was quiet for one request" and "nothing is trending" are different claims.
    expect(resolve(0, 10)).toBe(10)
  })

  it('keeps the rows when the request fails outright', () => {
    expect(resolve(0, 6)).toBe(6)
  })

  it('takes a fuller answer over a held one', () => {
    expect(resolve(12, 10)).toBe(12)
  })

  it('takes an equal-length answer, which is the ordinary refresh', () => {
    expect(resolve(10, 10)).toBe(10)
  })

  it('shows nothing only when there is genuinely nothing on either side', () => {
    expect(resolve(0, 0)).toBe(0)
  })

  /** A thin answer must not shrink the list that is already drawn. */
  it('keeps ten rows when a thin request answers with one', () => {
    expect(resolve(1, 10)).toBe(10)
  })

  it('keeps the fuller list for any shortfall, not just a dramatic one', () => {
    expect(resolve(8, 10)).toBe(10)
  })

  it('lets a genuinely quieter hour through once the held list has had its turn', () => {
    // Otherwise a stale good list outvotes the truth for ever.
    expect(resolve(3, 10, true)).toBe(3)
  })
})
