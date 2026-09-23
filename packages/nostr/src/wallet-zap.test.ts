import { describe, expect, it } from 'vitest'

import { zapRequestFromInvoiceDescription, zapRequestOfReceipt, zappedEventId } from './zap'

/** The real zap nobody could see. */
const REAL_DESCRIPTION = "{\"kind\":9734,\"created_at\":1788482411,\"tags\":[[\"p\",\"f27341f6cf1e7abdf894372246332f58fe79c9925d489fe597218017314adfd3\"],[\"amount\",\"42000\"],[\"e\",\"b349dd6a61b673a35e4090b69e3b4cc73759d794b971e33d6480d91ad20d12ce\"],[\"relays\",\"wss://relay-b.example\",\"wss://relay-a.example\",\"wss://relay-c.example\"]],\"content\":\"Onward \ud83e\udee1\",\"pubkey\":\"2167df807b188633748f92c8d7552c3e5c55cde51363e89cf7978c773dfbced5\",\"id\":\"b46e41e3fbcc8169f8c63d37739036e3069fa58d9d2d22dfd1a489b701c3a847\",\"sig\":\"6c4cfcbe0b5b5f2c27284b26db6a6bd057ce0b31a5a2b00f90085bafa7989c8d9c031cbd66a561881b73c287da674070e83a2c63a6e4620d062923076d9d0297\"}"

describe('zapRequestFromInvoiceDescription', () => {
  it('recovers the signed zap request from a wallet payment', () => {
    const request = zapRequestFromInvoiceDescription(REAL_DESCRIPTION)
    expect(request).not.toBeNull()
    expect(request?.kind).toBe(9734)
    expect(request?.pubkey).toBe('2167df807b188633748f92c8d7552c3e5c55cde51363e89cf7978c773dfbced5')
    expect(request?.content).toBe("Onward \ud83e\udee1")
  })

  it('names the note it paid for', () => {
    const request = zapRequestFromInvoiceDescription(REAL_DESCRIPTION)
    expect(zappedEventId(request!)).toBe('b349dd6a61b673a35e4090b69e3b4cc73759d794b971e33d6480d91ad20d12ce')
  })

  it('refuses an ordinary payment description', () => {
    expect(zapRequestFromInvoiceDescription('coffee')).toBeNull()
    expect(zapRequestFromInvoiceDescription(undefined)).toBeNull()
    expect(zapRequestFromInvoiceDescription('')).toBeNull()
  })

  it('refuses malformed JSON without throwing', () => {
    expect(() => zapRequestFromInvoiceDescription('{"kind":9734,')).not.toThrow()
    expect(zapRequestFromInvoiceDescription('{"kind":9734,')).toBeNull()
  })

  it('refuses an UNSIGNED claim to be a zap request', () => {
    // Signature is the whole proof of who paid.
    const forged = JSON.parse(REAL_DESCRIPTION)
    forged.sig = '0'.repeat(128)
    expect(zapRequestFromInvoiceDescription(JSON.stringify(forged))).toBeNull()
  })

  it('refuses a validly signed event of the wrong kind', () => {
    const wrongKind = JSON.parse(REAL_DESCRIPTION)
    wrongKind.kind = 1
    expect(zapRequestFromInvoiceDescription(JSON.stringify(wrongKind))).toBeNull()
  })
})

describe('zapRequestOfReceipt', () => {
  it('reads the same request back out of a receipt, so the two sources dedupe', () => {
    const receipt = {
      id: 'a'.repeat(64), kind: 9735, pubkey: 'b'.repeat(64), created_at: 1, content: '',
      sig: '0'.repeat(128), tags: [['description', REAL_DESCRIPTION]],
    }
    const fromReceipt = zapRequestOfReceipt(receipt as never)
    const fromWallet = zapRequestFromInvoiceDescription(REAL_DESCRIPTION)
    expect(fromReceipt?.id).toBe(fromWallet?.id)
  })

  it('is null for a receipt with no description tag', () => {
    const receipt = { id: 'a'.repeat(64), kind: 9735, pubkey: 'b'.repeat(64), created_at: 1, content: '', sig: '0'.repeat(128), tags: [] }
    expect(zapRequestOfReceipt(receipt as never)).toBeNull()
  })
})
