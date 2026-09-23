import { describe, expect, it } from 'vitest'

import { authorAccepted } from './quality'

/** "I only see my own post after a hard refresh." A gated tab judges an author. */
const ME = 'a'.repeat(64)
const THEM = 'b'.repeat(64)

describe('authorAccepted', () => {
  it('accepts my own note while my verdict is still loading', () => {
    expect(authorAccepted(ME, 'loading', ME)).toBe(true)
  })

  it('accepts my own note when no verdict exists at all, the moment after publishing', () => {
    expect(authorAccepted(ME, undefined, ME)).toBe(true)
  })

  it('accepts my own note even if my own profile would fail the gate', () => {
    // Whatever the rule says about strangers, it is not a reason to hide what I just wrote.
    expect(authorAccepted(ME, 'fail', ME)).toBe(true)
  })

  it('still judges everybody else', () => {
    expect(authorAccepted(THEM, 'pass', ME)).toBe(true)
    expect(authorAccepted(THEM, 'fail', ME)).toBe(false)
    expect(authorAccepted(THEM, 'loading', ME)).toBe(false)
    expect(authorAccepted(THEM, undefined, ME)).toBe(false)
  })

  it('judges everybody when there is no reader to exempt', () => {
    expect(authorAccepted(ME, undefined, undefined)).toBe(false)
    expect(authorAccepted(ME, 'pass', undefined)).toBe(true)
  })
})
