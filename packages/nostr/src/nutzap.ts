import type { Hex, NostrEvent } from './types'

/** NIP-61 nutzaps: a payment that is an EVENT, not a receipt for one. */

export const NUTZAP_KIND = 9321

export interface Nutzap {
  /** The event id, so callers can dedupe against everything else on a strip. */
  id: string
  /** Who sent. */
  sender: Hex
  /** Who. */
  recipient: Hex
  /** Total of the proofs, in sats. */
  amountSats: number
  /** The mint the ecash is drawn. */
  mint: string
  /** The note it is attached to, when it is attached to one. */
  targetId: string | undefined
  /** The payer's message, if any. */
  comment: string
  createdAt: number
}

/** Sum of the proof amounts. */
function sumProofs(tags: readonly (readonly string[])[]): number {
  let total = 0
  for (const tag of tags) {
    if (tag[0] !== 'proof' || typeof tag[1] !== 'string') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(tag[1])
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const amount = (parsed as { amount?: unknown }).amount
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) continue
    total += amount
  }
  return total
}

/** A nutzap, or undefined when the event does not stand up as one. */
export function parseNutzap(event: NostrEvent, recipient: Hex): Nutzap | undefined {
  if (event.kind !== NUTZAP_KIND) return undefined
  const p = event.tags.find(tag => tag[0] === 'p')?.[1]
  if (p !== recipient) return undefined
  const mint = event.tags.find(tag => tag[0] === 'u')?.[1]
  if (typeof mint !== 'string' || mint === '') return undefined
  const amountSats = sumProofs(event.tags)
  if (amountSats <= 0) return undefined
  return {
    id: event.id,
    sender: event.pubkey,
    recipient,
    amountSats,
    mint,
    // `e` is optional: a nutzap can be sent to a person rather than to one of their notes.
    targetId: event.tags.find(tag => tag[0] === 'e')?.[1],
    comment: typeof event.content === 'string' ? event.content : '',
    createdAt: event.created_at,
  }
}
