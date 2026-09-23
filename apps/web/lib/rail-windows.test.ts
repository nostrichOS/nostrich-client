import { beforeEach, describe, expect, it } from 'vitest'

import { TOPICS_WINDOW_KEY, TRENDING_WINDOW_KEY } from './rail-windows'
import { setActiveScope } from './scope'
import { SYNCED_SETTINGS } from './settings-keys'

/** The rail's window pickers, and the one way they differ from every other preference. */

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

beforeEach(() => {
  localStorage.clear()
  setActiveScope(ALICE)
})

describe('the window keys', () => {
  it('are two different keys, the panels are two different questions', () => {
    expect(TRENDING_WINDOW_KEY).not.toBe(TOPICS_WINDOW_KEY)
  })

  it('are NOT per-account settings, and must not be synced as one', () => {
    const bases = SYNCED_SETTINGS.map(entry => entry.base)
    expect(bases).not.toContain(TRENDING_WINDOW_KEY)
    expect(bases).not.toContain(TOPICS_WINDOW_KEY)
  })
})

describe('storage', () => {
  it('is unscoped, so switching accounts keeps the window', () => {
    localStorage.setItem(TRENDING_WINDOW_KEY, '1')

    setActiveScope(BOB)
    // The same value, under the same key.
    expect(localStorage.getItem(TRENDING_WINDOW_KEY)).toBe('1')

    setActiveScope(ALICE)
    expect(localStorage.getItem(TRENDING_WINDOW_KEY)).toBe('1')
  })

  it('writes a bare key with no account suffix on it', () => {
    localStorage.setItem(TOPICS_WINDOW_KEY, '4')
    expect(localStorage.getItem(TOPICS_WINDOW_KEY)).toBe('4')
    // `lib/scope` stores under `<base>::<pubkey>`.
    expect(localStorage.getItem(`${TOPICS_WINDOW_KEY}::${ALICE}`)).toBeNull()
    expect(localStorage.getItem(`${TOPICS_WINDOW_KEY}::${BOB}`)).toBeNull()
  })

  it('keeps the two panels independent', () => {
    localStorage.setItem(TRENDING_WINDOW_KEY, '1')
    localStorage.setItem(TOPICS_WINDOW_KEY, '24')
    expect(localStorage.getItem(TRENDING_WINDOW_KEY)).toBe('1')
    expect(localStorage.getItem(TOPICS_WINDOW_KEY)).toBe('24')
  })
})
