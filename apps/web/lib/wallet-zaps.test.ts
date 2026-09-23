import { describe, expect, it } from 'vitest'

import { isZapPayment, mergeWalletZaps, newZapsFromWallet, walletZapsByNote, zapEntriesFromPayments, type WalletZap } from './wallet-zaps'
import type { WalletPayment } from './wallet-ledger'
import type { ZapDetail } from './interactions'

/** A zap that no relay has, recovered from the money. */
const NOTE = 'b349dd6a61b673a35e4090b69e3b4cc73759d794b971e33d6480d91ad20d12ce'
const PAYER = 'dba168fc95fdbd94b40096f4a6db1a296c0e85c4231bfc9226fca5b7fcc3e5ca'

const payment = (over: Partial<WalletPayment> = {}): WalletPayment => ({
  id: 'p1',
  sats: 42,
  at: 1788482432,
  incoming: true,
  ...over,
})

describe('walletZapsByNote', () => {
  it('ignores an ordinary payment', () => {
    expect(walletZapsByNote([payment({ description: 'coffee' })]).size).toBe(0)
  })

  it('ignores a payment with no description at all', () => {
    expect(walletZapsByNote([payment()]).size).toBe(0)
  })

  it('ignores an outgoing payment, whatever it carries', () => {
    // A wallet can only prove what was paid TO its owner.
    const out = walletZapsByNote([payment({ incoming: false, description: '{"kind":9734}' })])
    expect(out.size).toBe(0)
  })

  it('refuses a description that merely claims to be a zap request', () => {
    // Unsigned, so it proves nobody sent anything.
    const forged = JSON.stringify({
      kind: 9734, id: 'a'.repeat(64), pubkey: PAYER, created_at: 1, content: 'gm',
      tags: [['e', NOTE]], sig: '0'.repeat(128),
    })
    expect(walletZapsByNote([payment({ description: forged })]).size).toBe(0)
  })

  it('refuses a description that is not JSON at all without throwing', () => {
    expect(() => walletZapsByNote([payment({ description: '{ not json' })])).not.toThrow()
    expect(walletZapsByNote([payment({ description: '{ not json' })]).size).toBe(0)
  })
})

describe('mergeWalletZaps', () => {
  const fromWallet: WalletZap[] = [
    { noteId: NOTE, requestId: 'req-4', sender: PAYER as never, sats: 42, at: 400 },
  ]

  it('adds a zap the relays never carried', () => {
    const known: ZapDetail[] = [{ sender: 'x'.repeat(64) as never, sats: 21, at: 100, requestId: 'req-1' }]
    const merged = mergeWalletZaps(known, fromWallet, NOTE)
    expect(merged).toHaveLength(2)
    expect(merged.reduce((n, z) => n + z.sats, 0)).toBe(63)
  })

  it('does NOT count a zap twice when a receipt already carried it', () => {
    // The exact case the request id exists.
    const known: ZapDetail[] = [{ sender: PAYER as never, sats: 42, at: 400, requestId: 'req-4' }]
    expect(mergeWalletZaps(known, fromWallet, NOTE)).toHaveLength(1)
  })

  it('does not merge two genuine zaps of the same size from the same person', () => {
    // Why the key is the request id and not sender+amount: these are two payments, not one.
    const known: ZapDetail[] = [{ sender: PAYER as never, sats: 42, at: 399, requestId: 'req-3' }]
    expect(mergeWalletZaps(known, fromWallet, NOTE)).toHaveLength(2)
  })

  it('keeps a wallet zap for a DIFFERENT note off this one', () => {
    const other: WalletZap[] = [{ ...fromWallet[0]!, noteId: 'f'.repeat(64), requestId: 'req-9' }]
    expect(mergeWalletZaps([], other, NOTE)).toHaveLength(0)
  })

  it('is a no-op when the wallet knows nothing', () => {
    const known: ZapDetail[] = [{ sender: PAYER as never, sats: 42, at: 400 }]
    expect(mergeWalletZaps(known, [], NOTE)).toEqual(known)
  })

  it('leaves relay zaps alone when a receipt has no request id to compare', () => {
    // An older cached ZapDetail predates the field.
    const known: ZapDetail[] = [{ sender: 'y'.repeat(64) as never, sats: 21, at: 100 }]
    expect(mergeWalletZaps(known, fromWallet, NOTE)).toHaveLength(2)
  })

  it('orders newest first, which is what the strip reads', () => {
    const known: ZapDetail[] = [{ sender: 'z'.repeat(64) as never, sats: 21, at: 900, requestId: 'req-0' }]
    expect(mergeWalletZaps(known, fromWallet, NOTE)[0]?.at).toBe(900)
  })
})

describe('the Received tab', () => {
  const REQ = 'r'.repeat(64)
  const zapPayment = (over: Partial<WalletPayment> = {}): WalletPayment => ({
    id: 'p9', sats: 42, at: 500, incoming: true,
    description: JSON.stringify({ kind: 9734, id: REQ, pubkey: PAYER, created_at: 1, content: 'nice', tags: [['e', NOTE]], sig: '0'.repeat(128) }),
    ...over,
  })

  it('leaves an ordinary invoice as an anonymous payment', () => {
    // A withdrawal or an invoice somebody paid is not a zap and must not grow a sender.
    expect(isZapPayment(payment({ description: 'invoice for the thing' }))).toBe(false)
    expect(zapEntriesFromPayments([payment({ description: 'invoice' })])).toHaveLength(0)
  })

  it('does not promote an UNSIGNED description into somebody’s name', () => {
    // The signature is the whole proof.
    expect(zapEntriesFromPayments([zapPayment()])).toHaveLength(0)
  })

  it('never promotes an outgoing payment', () => {
    expect(isZapPayment(zapPayment({ incoming: false }))).toBe(false)
  })

  it('drops a wallet zap the relays already announced', () => {
    const known = [{ id: 'x', counterparty: PAYER as never, sats: 42, createdAt: 500, senderVerified: true, requestId: REQ }]
    const fromWallet = [{ id: `wallet:${REQ}`, counterparty: PAYER as never, sats: 42, createdAt: 500, senderVerified: true, requestId: REQ }]
    expect(newZapsFromWallet(known, fromWallet)).toHaveLength(0)
  })

  it('keeps one the relays never had', () => {
    const known = [{ id: 'x', counterparty: PAYER as never, sats: 21, createdAt: 100, senderVerified: true, requestId: 'other' }]
    const fromWallet = [{ id: `wallet:${REQ}`, counterparty: PAYER as never, sats: 42, createdAt: 500, senderVerified: true, requestId: REQ }]
    expect(newZapsFromWallet(known, fromWallet)).toHaveLength(1)
  })

  it('does not dedupe against a relay zap whose request id is unknown', () => {
    // An older cached entry predates the field.
    const known = [{ id: 'x', counterparty: PAYER as never, sats: 42, createdAt: 500, senderVerified: true }]
    const fromWallet = [{ id: `wallet:${REQ}`, counterparty: PAYER as never, sats: 42, createdAt: 500, senderVerified: true, requestId: REQ }]
    expect(newZapsFromWallet(known, fromWallet)).toHaveLength(1)
  })
})
