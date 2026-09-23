'use client'

import { useQuery } from '@tanstack/react-query'
import {
  NUTZAP_KIND,
  eventAddress,
  isAddressable,
  parseNutzap,
  validateZapReceipt,
  zapRequestOfReceipt,
  type Hex,
  type NostrEvent,
} from '@nostrich/nostr'

import { getPool } from './pool'
import { zapRelays } from './zap-relays'
import { markZapsSettled, rememberZaps } from './zap-store'
import type { ZapDetail } from './interactions'

/** Every zap on ONE note, asked for on its own behalf. */

/** Long enough to hear from the slow relays. */
const TIMEOUT_MS = 7_000

/** Receipts requested. */
const LIMIT = 200

export function useNoteZaps(event: NostrEvent | undefined): ZapDetail[] {
  const id = event?.id
  const address =
    event !== undefined && isAddressable(event.kind) ? eventAddress(event) : undefined

  const query = useQuery({
    queryKey: ['note-zaps', id ?? '', address ?? ''],
    queryFn: async (): Promise<ZapDetail[]> => {
      if (id === undefined) return []
      /* Two kinds, because there are two ways to be paid on Nostr. */
      const filters = [
        { kinds: [9735, NUTZAP_KIND], '#e': [id], limit: LIMIT },
        ...(address === undefined
          ? []
          : [{ kinds: [9735, NUTZAP_KIND], '#a': [address], limit: LIMIT }]),
      ]
      /* `graceMs: 0`. */
      // `zapRelays()` rather than the default set: a receipt lands wherever the SENDER's.
      const receipts = await getPool().query(filters as never, zapRelays(), TIMEOUT_MS, {
        graceMs: 0,
      })

      const byId = new Map<string, ZapDetail>()
      for (const receipt of receipts) {
        if (byId.has(receipt.id)) continue
        /* The sender and the comment come from the SIGNED zap request inside the receipt. */
        /* A nutzap needs no receipt to validate: it IS the payment, so its author. */
        if (receipt.kind === NUTZAP_KIND) {
          const nut = parseNutzap(receipt, event?.pubkey as never)
          if (nut === undefined) continue
          byId.set(receipt.id, {
            sender: nut.sender,
            sats: nut.amountSats,
            ...(nut.comment === '' ? {} : { comment: nut.comment }),
            at: nut.createdAt,
          })
          continue
        }
        const result = validateZapReceipt({ receipt })
        if (!result.ok) continue
        const sats = satsOf(receipt)
        if (sats <= 0) continue
        // Carried so a zap the WALLET also knows about is recognised as the same payment.
        const request = zapRequestOfReceipt(receipt)
        byId.set(receipt.id, {
          sender: result.value.senderPubkey,
          sats,
          ...(request === null ? {} : { requestId: request.id }),
          ...(result.value.comment === undefined || result.value.comment === ''
            ? {}
            : { comment: result.value.comment }),
          at: result.value.createdAt,
        })
      }
      // Newest first, which is what the row of faces reads.
      const found = [...byId.values()].sort((a, b) => b.at - a.at)
      /* Published to the shared store before returning, so every other surface showing. */
      rememberZaps(id, found)
      markZapsSettled([id])
      return found
    },
    enabled: id !== undefined,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  return query.data ?? []
}

const AMOUNT = /lnbc(\d+)([munp])/i
const DIVISOR: Record<string, number> = { m: 1e3, u: 1e6, n: 1e9, p: 1e12 }

/** The amount lives in the bolt11, which is the part the payer actually settled. */
function satsOf(receipt: NostrEvent): number {
  const bolt11 = receipt.tags.find(tag => tag[0] === 'bolt11')?.[1]
  if (bolt11 === undefined) return 0
  const match = AMOUNT.exec(bolt11)
  if (match === null) return 0
  const raw = Number(match[1])
  const div = DIVISOR[(match[2] ?? '').toLowerCase()]
  if (!Number.isFinite(raw) || div === undefined) return 0
  return Math.round((raw / div) * 1e8)
}

export type { Hex }
