import { beforeEach, describe, expect, it, vi } from 'vitest'

import { writeScoped } from './scope'
import { knownInsufficient, storedBalance } from './wallet'

/** The only check left between a reader and a zap. */

// Written through the same scoped store the code reads, rather than a guessed raw.
const WALLET = 'f'.repeat(64)
const OTHER_WALLET = 'e'.repeat(64)

const store = (msat: number, ageMs = 0, wallet = WALLET): void => {
  writeScoped('wallet-balance', JSON.stringify({ msat, at: Date.now() - ageMs, wallet }))
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('knownInsufficient', () => {
  it('does NOT refuse when no balance is known', () => {
    // A wallet that will not report a balance still pays perfectly well.
    expect(knownInsufficient(1_000, WALLET)).toBe(false)
  })

  it('refuses a zap larger than the wallet holds', () => {
    store(100_000) // 100 sats
    expect(knownInsufficient(200, WALLET)).toBe(true)
  })

  it('allows a zap the wallet can cover', () => {
    store(100_000)
    expect(knownInsufficient(50, WALLET)).toBe(false)
  })

  it('allows a zap for exactly the balance', () => {
    store(100_000)
    expect(knownInsufficient(100, WALLET)).toBe(false)
  })

  it('refuses any zap at all from an empty wallet', () => {
    store(0)
    expect(knownInsufficient(1, WALLET)).toBe(true)
  })

  it('ignores a balance too old to be trusted, rather than refusing on it', () => {
    // The reader may have topped up.
    store(0, 13 * 60 * 60_000)
    expect(knownInsufficient(1_000, WALLET)).toBe(false)
  })
})

describe('storedBalance', () => {
  it('has no answer when nothing is stored', () => {
    expect(storedBalance(WALLET)).toBeUndefined()
  })

  it('survives a stored value that is not what it expects', () => {
    writeScoped('wallet-balance', 'not json')
    expect(() => storedBalance(WALLET)).not.toThrow()
    expect(storedBalance(WALLET)).toBeUndefined()
  })

  it('ignores a record missing its timestamp', () => {
    writeScoped('wallet-balance', JSON.stringify({ msat: 5 }))
    expect(storedBalance(WALLET)).toBeUndefined()
  })
})

describe('switching wallets', () => {
  it('never answers with a balance recorded against a DIFFERENT wallet', () => {
    // Reported after switching from the provider to an Alby Hub: the old balance kept.
    store(500_000, 0, OTHER_WALLET)
    expect(storedBalance(WALLET)).toBeUndefined()
    expect(knownInsufficient(1_000_000, WALLET)).toBe(false)
  })

  it('ignores a figure written before wallets were part of the record', () => {
    writeScoped('wallet-balance', JSON.stringify({ msat: 1, at: Date.now() }))
    expect(storedBalance(WALLET)).toBeUndefined()
  })

  it('has no answer at all when no wallet is connected', () => {
    store(500_000)
    expect(storedBalance(undefined)).toBeUndefined()
    expect(knownInsufficient(1_000_000, undefined)).toBe(false)
  })
})
