import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile, Signer } from '@nostrich/nostr'

/** The paying sequence, and the two things about it that are only ever wrong with money. */

const createZapInvoice = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const payInvoice = vi.fn<(...args: unknown[]) => Promise<unknown>>()

vi.mock('@nostrich/nostr', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createZapInvoice,
}))
vi.mock('./wallet', () => ({ payInvoice }))

const { sendZap, paymentFailureText } = await import('./zap-send')

const RECIPIENT = 'a'.repeat(64)
const PROFILE: Profile = { pubkey: RECIPIENT, lud16: 'bob@example.com', updatedAt: 0 }
const SIGNER = {} as Signer

function built(overrides: Record<string, unknown> = {}) {
  return { ok: true, value: { bolt11: 'lnbc210n1p…', zap: true, verified: true, ...overrides } }
}

beforeEach(() => {
  createZapInvoice.mockReset()
  payInvoice.mockReset()
})

describe('sendZap', () => {
  it('asks for millisats, not sats', async () => {
    createZapInvoice.mockResolvedValue(built())
    payInvoice.mockResolvedValue({ ok: true, preimage: 'ff', via: 'nwc' })

    await sendZap({ recipient: RECIPIENT, profile: PROFILE, amountSats: 21, signer: SIGNER, client: undefined })

    const arg = createZapInvoice.mock.calls[0]?.[0] as { target: { amountMsat: number } }
    expect(arg.target.amountMsat).toBe(21_000)
  })

  it('scales every amount by exactly a thousand', async () => {
    createZapInvoice.mockResolvedValue(built())
    payInvoice.mockResolvedValue({ ok: true, preimage: 'ff', via: 'nwc' })

    for (const sats of [1, 21, 500, 21_000, 1_000_000]) {
      createZapInvoice.mockClear()
      await sendZap({ recipient: RECIPIENT, profile: PROFILE, amountSats: sats, signer: SIGNER, client: undefined })
      const arg = createZapInvoice.mock.calls[0]?.[0] as { target: { amountMsat: number } }
      expect(arg.target.amountMsat).toBe(sats * 1_000)
    }
  })

  it('carries the wallet verdict through, so an unknown outcome stays unknown', async () => {
    createZapInvoice.mockResolvedValue(built())
    payInvoice.mockResolvedValue({ ok: false, message: 'The wallet did not answer.', refused: false })

    const result = await sendZap({ recipient: RECIPIENT, profile: PROFILE, amountSats: 21, signer: SIGNER, client: undefined })
    expect(result).toMatchObject({ ok: false, stage: 'payment', refused: false })
  })

  it('reports a refusal as a refusal', async () => {
    createZapInvoice.mockResolvedValue(built())
    payInvoice.mockResolvedValue({ ok: false, message: 'Insufficient balance.', refused: true })

    const result = await sendZap({ recipient: RECIPIENT, profile: PROFILE, amountSats: 21, signer: SIGNER, client: undefined })
    expect(result).toMatchObject({ ok: false, stage: 'payment', refused: true })
  })

  it('never pays when no invoice was issued', async () => {
    createZapInvoice.mockResolvedValue({ ok: false, error: { message: 'No lightning address.' } })

    const result = await sendZap({ recipient: RECIPIENT, profile: PROFILE, amountSats: 21, signer: SIGNER, client: undefined })
    expect(result).toMatchObject({ ok: false, stage: 'invoice', refused: true })
    expect(payInvoice).not.toHaveBeenCalled()
  })

  it('reports a paid invoice that is not a zap, and never claims it was verified', async () => {
    createZapInvoice.mockResolvedValue(built({ zap: false, verified: true }))
    payInvoice.mockResolvedValue({ ok: true, preimage: 'ff', via: 'webln' })

    const result = await sendZap({ recipient: RECIPIENT, profile: PROFILE, amountSats: 21, signer: SIGNER, client: undefined })
    expect(result).toMatchObject({ ok: true, zap: false, verified: false, via: 'webln' })
  })
})

describe('paymentFailureText', () => {
  it('leaves a refusal exactly as the wallet worded it', () => {
    expect(paymentFailureText({ message: 'Insufficient balance.', refused: true })).toBe('Insufficient balance.')
  })

  it('warns that an unanswered payment may already have been paid', () => {
    const text = paymentFailureText({ message: 'The wallet did not answer.', refused: false })
    expect(text).toContain('The wallet did not answer.')
    expect(text).toMatch(/may already have been paid/)
  })
})

/** There is no not-a-zap notice any more, and its test went. */
