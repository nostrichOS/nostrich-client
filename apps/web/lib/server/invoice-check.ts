import { decodeBolt11 } from '@nostrich/nostr'

/** Does this invoice ask for what we asked it to ask. */
export type InvoiceCheck = { ok: true } | { ok: false; reason: string }

export function checkInvoiceAmount(bolt11: string, sats: number): InvoiceCheck {
  const decoded = decodeBolt11(bolt11)
  if (decoded === null) return { ok: false, reason: 'The wallet returned an invoice we could not read.' }
  if (decoded.amountMsat === null) {
    return { ok: false, reason: 'The wallet returned an invoice with no amount on it.' }
  }
  if (decoded.amountMsat !== sats * 1000) {
    return { ok: false, reason: 'The wallet returned an invoice for a different amount.' }
  }
  /* Mainnet only. */
  if (decoded.network !== 'bc' && decoded.network !== '') {
    return { ok: false, reason: 'The wallet returned an invoice for the wrong network.' }
  }
  return { ok: true }
}
