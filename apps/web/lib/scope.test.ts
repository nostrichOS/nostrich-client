import { beforeEach, describe, expect, it } from 'vitest'

import {
  ANON_SCOPE,
  activeScope,
  inheritScoped,
  readScoped,
  resolveScope,
  scopedRecord,
  setActiveScope,
  writeScoped,
  SCOPED_READER_JS,
} from './scope'

/** The rules that make a preference belong to an account. */

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const KEY = 'test:pref'

function accounts(list: string[], active?: string): void {
  localStorage.setItem(
    'nostrich.accounts',
    JSON.stringify({
      accounts: list.map(pubkey => ({ kind: 'readonly', pubkey })),
      ...(active === undefined ? {} : { active }),
    }),
  )
}

beforeEach(() => {
  localStorage.clear()
  setActiveScope(undefined)
})

describe('resolveScope', () => {
  it('is anon with no accounts', () => {
    expect(resolveScope()).toBe(ANON_SCOPE)
  })

  it('is the active account when it is present', () => {
    accounts([ALICE, BOB], BOB)
    expect(resolveScope()).toBe(BOB)
  })

  it('falls back to the first account when nothing was recorded as active', () => {
    accounts([ALICE, BOB])
    expect(resolveScope()).toBe(ALICE)
  })

  it('is anon when the recorded account did not come back', () => {
    // SessionProvider refuses to promote a different key in this case, and so does.
    accounts([ALICE], BOB)
    expect(resolveScope()).toBe(ANON_SCOPE)
  })
})

describe('per account', () => {
  it('does not carry one account’s value to another', () => {
    setActiveScope(ALICE)
    writeScoped(KEY, 'alice-value')
    setActiveScope(BOB)
    expect(readScoped(KEY)).toBeNull()
    writeScoped(KEY, 'bob-value')
    setActiveScope(ALICE)
    expect(readScoped(KEY)).toBe('alice-value')
  })

  it('keeps a signed-out reader’s own copy', () => {
    writeScoped(KEY, 'anon-value')
    expect(activeScope()).toBe(ANON_SCOPE)
    setActiveScope(ALICE)
    expect(readScoped(KEY)).toBeNull()
  })
})

describe('adopting a pre-account value', () => {
  it('takes it over on a device with one account', () => {
    accounts([ALICE], ALICE)
    setActiveScope(ALICE)
    localStorage.setItem(KEY, 'from-before')
    expect(readScoped(KEY)).toBe('from-before')
    // Stamped at zero, so any real timestamp from another device wins the merge.
    expect(scopedRecord(KEY)?.at).toBe(0)
  })

  it('refuses on a device with two, where it belongs to nobody in particular', () => {
    accounts([ALICE, BOB], ALICE)
    setActiveScope(ALICE)
    localStorage.setItem(KEY, 'from-before')
    expect(readScoped(KEY)).toBeNull()
  })
})

describe('inheritScoped', () => {
  it('copies the signed-out value into an account that has none', () => {
    writeScoped(KEY, 'muted-while-signed-out')
    setActiveScope(ALICE)
    expect(inheritScoped(KEY, ANON_SCOPE)).toBe(true)
    expect(readScoped(KEY)).toBe('muted-while-signed-out')
  })

  it('never overwrites a value the account already has', () => {
    writeScoped(KEY, 'anon')
    setActiveScope(ALICE)
    writeScoped(KEY, 'mine')
    expect(inheritScoped(KEY, ANON_SCOPE)).toBe(false)
    expect(readScoped(KEY)).toBe('mine')
  })
})

describe('the pre-paint reader', () => {
  it('resolves the same value the module does', () => {
    accounts([ALICE, BOB], BOB)
    setActiveScope(BOB)
    writeScoped(KEY, 'bob-theme')
    // eslint-disable-next-line no-eval -- the script is generated source; this is what a <script> would do.
    const read = eval(SCOPED_READER_JS) as (base: string) => string | null
    expect(read(KEY)).toBe('bob-theme')
  })

  it('agrees about which account is active', () => {
    accounts([ALICE, BOB], ALICE)
    setActiveScope(ALICE)
    writeScoped(KEY, 'alice-theme')
    setActiveScope(BOB)
    writeScoped(KEY, 'bob-theme')
    accounts([ALICE, BOB], BOB)
    // eslint-disable-next-line no-eval -- see above.
    const read = eval(SCOPED_READER_JS) as (base: string) => string | null
    expect(read(KEY)).toBe('bob-theme')
  })
})

describe('storage pressure', () => {
  /** A decision the reader made must outlive a cache we can refetch. */
  it('drops caches and retries when storage is full', async () => {
    accounts([ALICE], ALICE)
    // Something disposable already occupying room, filed as a cache in the inventory.
    localStorage.setItem('nostrich:profiles:v1', 'x'.repeat(64))

    const real = Storage.prototype.setItem
    let full = true
    const attempts: string[] = []
    Storage.prototype.setItem = function patched(this: Storage, k: string, v: string): void {
      attempts.push(k)
      // Only the scoped preference is refused, and only while "full".
      if (full && k.startsWith(KEY)) throw new DOMException('quota', 'QuotaExceededError')
      real.call(this, k, v)
    }
    try {
      writeScoped(KEY, 'kept')
      expect(readScoped(KEY)).toBeNull()
      full = false
      // The retry lands after the dynamic imports resolve.
      await new Promise(resolve => setTimeout(resolve, 120))
      expect(readScoped(KEY)).toBe('kept')
      expect(localStorage.getItem('nostrich:profiles:v1')).toBeNull()
    } finally {
      Storage.prototype.setItem = real
    }
  })
})
