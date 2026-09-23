import { describe, expect, it } from 'vitest'

/** Switching the trending window has to actually change the notes. */

/** `entries.length < held.length && !stale` keeps `held`. */
const resolve = (fresh: number, held: number, stale = false): number => {
  if (fresh < held && !stale) return held
  return fresh > 0 ? fresh : held
}

/** What the merge is allowed to treat as "what we have": this window's rows only. */
const heldFor = (
  shown: { window: number; entries: number } | undefined,
  hours: number,
): number => (shown !== undefined && shown.window === hours ? shown.entries : 0)

/** Live snapshot sizes. 24h is the short one, which is the whole trap. */
const SIZES: Record<number, number> = { 1: 40, 4: 40, 24: 31 }

/** Walk the picker, carrying state across, the way the hook does. */
function walk(sequence: number[]): { window: number; entries: number } {
  let shown: { window: number; entries: number } | undefined
  const lastGood = new Set<number>()
  for (const hours of sequence) {
    const fresh = SIZES[hours] ?? 0
    // A window never loaded before is `stale`, which is what made the first pass work.
    const stale = !lastGood.has(hours)
    shown = { window: hours, entries: resolve(fresh, heldFor(shown, hours), stale) }
    lastGood.add(hours)
  }
  return shown ?? { window: 0, entries: 0 }
}

describe('the trending window picker changes the list', () => {
  it('shows the 24h list when 24h is chosen after 1h', () => {
    // The exact reported sequence: the second visit to 24h is the one that used to stick.
    expect(walk([24, 1, 4, 1, 24])).toEqual({ window: 24, entries: 31 })
  })

  it('takes the shorter 24h list even though 1h is on screen and fuller', () => {
    expect(walk([24, 1, 24])).toEqual({ window: 24, entries: 31 })
  })

  it('still works on the first pass, which always did', () => {
    expect(walk([24, 1])).toEqual({ window: 1, entries: 40 })
    expect(walk([24, 1, 4])).toEqual({ window: 4, entries: 40 })
  })

  it('returns to a window it has already shown', () => {
    expect(walk([1, 24, 1])).toEqual({ window: 1, entries: 40 })
  })

  it('survives every order of the three windows', () => {
    const windows = [1, 4, 24]
    for (const a of windows) {
      for (const b of windows) {
        for (const c of windows) {
          const end = walk([a, b, c, a, b, c])
          expect(end.entries, `${a} → ${b} → ${c} → ${a} → ${b} → ${c}`).toBe(SIZES[end.window])
        }
      }
    }
  })
})

describe('the same-window rule is untouched', () => {
  it('still keeps ten rows when a thin request for the SAME window answers with one', () => {
    // The bug this guard exists for: one unlucky request must not strip the panel.
    expect(resolve(1, heldFor({ window: 24, entries: 10 }, 24))).toBe(10)
  })

  it('still keeps the rows when the same window answers with nothing', () => {
    expect(resolve(0, heldFor({ window: 1, entries: 10 }, 1))).toBe(10)
  })

  it('still lets a genuinely quieter hour through once the held list has had its turn', () => {
    expect(resolve(3, heldFor({ window: 1, entries: 10 }, 1), true)).toBe(3)
  })
})
