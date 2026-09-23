import { beforeEach, describe, expect, it } from 'vitest'

import { STORED_ITEMS, clearByKind, inspectStorage, unknownKeys } from './dev-tools'
import { setActiveScope, writeScoped } from './scope'
import { CHAT_DELETED_KEY, CUSTOM_FEEDS_KEY } from './settings-keys'

/** THE STORAGE SCREEN MUST NOT DELETE THE SETTINGS IT LISTS. */

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

function signedInAs(pubkey: string): void {
  localStorage.setItem(
    'nostrich.accounts',
    JSON.stringify({ accounts: [{ kind: 'readonly', pubkey }], active: pubkey }),
  )
  setActiveScope(pubkey)
}

beforeEach(() => {
  localStorage.clear()
  setActiveScope(undefined)
})

describe('unknownKeys', () => {
  it('does not call a scoped copy of a listed setting a leftover', () => {
    signedInAs(ALICE)
    writeScoped(CHAT_DELETED_KEY, JSON.stringify(['a:b']))
    expect(unknownKeys()).toEqual([])
  })

  it('does not call ANOTHER account\'s copy a leftover either', () => {
    // The screen is device-wide.
    signedInAs(BOB)
    writeScoped(CUSTOM_FEEDS_KEY, JSON.stringify([]))
    signedInAs(ALICE)
    expect(unknownKeys()).toEqual([])
  })

  it('still reports a key nothing in the inventory explains', () => {
    // The feature has to keep working: an orphan from an older version is exactly.
    localStorage.setItem('nostrich:some-removed-feature:v1', '1')
    expect(unknownKeys()).toEqual(['nostrich:some-removed-feature:v1'])
  })

  it('ignores storage this app did not write', () => {
    localStorage.setItem('some-other-app', '1')
    expect(unknownKeys()).toEqual([])
  })
})

describe('inspectStorage', () => {
  it('sees a scoped value rather than reporting the setting as absent', () => {
    // Read against the bare base, every preference showed as absent and 0 bytes.
    signedInAs(ALICE)
    writeScoped(CUSTOM_FEEDS_KEY, JSON.stringify([{ id: 'x', name: 'Zaps', hashtags: [], authors: [] }]))
    const row = inspectStorage().find(item => item.key === CUSTOM_FEEDS_KEY)
    expect(row?.present).toBe(true)
    expect(row?.bytes).toBeGreaterThan(0)
  })

  it('reports absent when nothing is stored', () => {
    signedInAs(ALICE)
    const row = inspectStorage().find(item => item.key === CUSTOM_FEEDS_KEY)
    expect(row).toMatchObject({ present: false, bytes: 0 })
  })
})

describe('clearByKind', () => {
  it('actually removes a scoped preference', () => {
    // Removing the bare base name deleted nothing, so "clear my preferences" reported.
    signedInAs(ALICE)
    writeScoped(CUSTOM_FEEDS_KEY, JSON.stringify([]))
    // Asserted against localStorage itself, not through `inspectStorage`: reading.
    const real = `${CUSTOM_FEEDS_KEY}::${ALICE}`
    expect(localStorage.getItem(real)).not.toBeNull()
    clearByKind(['preference'])
    expect(localStorage.getItem(real)).toBeNull()
  })

  it('leaves the other kinds alone', () => {
    signedInAs(ALICE)
    const cache = STORED_ITEMS.find(item => item.kind === 'cache')
    expect(cache).toBeDefined()
    localStorage.setItem(cache?.key ?? '', 'x')
    clearByKind(['preference'])
    expect(localStorage.getItem(cache?.key ?? '')).toBe('x')
  })
})
