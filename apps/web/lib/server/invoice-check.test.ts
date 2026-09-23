import { describe, expect, it } from 'vitest'

import { checkInvoiceAmount } from './invoice-check'

/** The donate page names an amount in large type. */

// BOLT-11 spec vector: 20m on mainnet.
const TWENTY_MILLI =
  'lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qrsgq7ea976txfraylvgzuxs8kgcw23ezlrszfnh8r6qtfpr6cxga50aj6txm9rxrydzd06dfeawfk6swupvz4erwnyutnjq7x39ymw6j38gp7ynn44'

describe('checkInvoiceAmount', () => {
  it('accepts an invoice for exactly what was asked', () => {
    expect(checkInvoiceAmount(TWENTY_MILLI, 2_000_000)).toEqual({ ok: true })
  })

  it('refuses an invoice for a different amount', () => {
    const result = checkInvoiceAmount(TWENTY_MILLI, 21)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: expect.stringMatching(/different amount/) })
  })

  it('refuses an invoice it cannot read', () => {
    expect(checkInvoiceAmount('not an invoice', 21).ok).toBe(false)
    expect(checkInvoiceAmount('', 21).ok).toBe(false)
  })

  it('is not fooled by an off-by-a-thousand', () => {
    // The classic: sats where millisats were meant.
    expect(checkInvoiceAmount(TWENTY_MILLI, 2_000_000_000).ok).toBe(false)
    expect(checkInvoiceAmount(TWENTY_MILLI, 2_000).ok).toBe(false)
  })
})
