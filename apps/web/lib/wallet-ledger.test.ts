import { describe, expect, it } from 'vitest'

import { paidByZap, unzappedIncome, type WalletLedger, type WalletPayment } from './wallet-ledger'
import type { ZapEntry } from './profile-zaps'

/** The merge behind the Received tab, which lists two ledgers as one. */

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const DESC_HASH = 'd'.repeat(64)

function zap(fields: Partial<ZapEntry>): ZapEntry {
  return {
    id: 'zap-1',
    counterparty: 'c'.repeat(64),
    sats: 21,
    createdAt: 1_000,
    senderVerified: true,
    ...fields,
  }
}

function payment(fields: Partial<WalletPayment>): WalletPayment {
  return { id: 'pay-1', sats: 21, at: 1_000, incoming: true, ...fields }
}

describe('a payment that is really a zap', () => {
  it('is recognised by payment hash', () => {
    expect(paidByZap(payment({ paymentHash: HASH_A }), [zap({ paymentHash: HASH_A })])).toBe(true)
  })

  it('is recognised by description hash, for wallets that report only that', () => {
    expect(
      paidByZap(payment({ descriptionHash: DESC_HASH }), [zap({ descriptionHash: DESC_HASH })]),
    ).toBe(true)
  })

  it('is not confused with a different payment of the same size at the same moment', () => {
    // Identity, not resemblance: two 21-sat payments a second apart are two payments.
    expect(paidByZap(payment({ paymentHash: HASH_B }), [zap({ paymentHash: HASH_A })])).toBe(false)
  })
})

describe('a payment that is not a zap', () => {
  it('survives when the wallet names it and no zap matches', () => {
    expect(paidByZap(payment({ paymentHash: HASH_B }), [zap({ paymentHash: HASH_A })])).toBe(false)
  })

  it('survives when the wallet reports no hashes at all', () => {
    /* The honest edge. */
    expect(paidByZap(payment({}), [zap({ paymentHash: HASH_A })])).toBe(false)
  })
})

describe('unzappedIncome', () => {
  const ledger = (incoming: WalletPayment[]): WalletLedger => ({
    incoming,
    outgoing: [],
    loading: false,
    supported: true,
    connected: true,
  })

  it('keeps only what the zap list does not already account for', () => {
    const zaps = [zap({ id: 'z1', paymentHash: HASH_A })]
    const result = unzappedIncome(
      ledger([
        payment({ id: 'p1', paymentHash: HASH_A }),
        payment({ id: 'p2', paymentHash: HASH_B, sats: 5_000 }),
      ]),
      zaps,
    )
    expect(result.map(item => item.id)).toEqual(['p2'])
  })

  it('is everything when there are no zaps, and nothing when there is no wallet', () => {
    expect(unzappedIncome(ledger([payment({ id: 'p1' })]), []).map(item => item.id)).toEqual(['p1'])
    expect(unzappedIncome(ledger([]), [zap({})])).toEqual([])
  })
})
