'use client'

import {
  createZapInvoice,
  DEFAULT_RELAYS,
  zapEndpointUrl,
  type Hex,
  type NostrEvent,
  type NwcClient,
  type Profile,
  type Signer,
} from '@nostrich/nostr'

import { payInvoice } from './wallet'

/** Sending a zap, with no dialog around. */

export type ZapResult =
  | {
      ok: true
      preimage: string
      via: 'nwc' | 'webln'
      /** False when their server does not speak NIP-57 at all. */
      zap: boolean
      /** False when the invoice committed to nothing, so we cannot prove it becomes a zap. */
      verified: boolean
    }
  | {
      ok: false
      stage: 'invoice' | 'payment'
      message: string
      /** False only when a payment was attempted and its outcome is unknown. */
      refused: boolean
    }

export interface ZapRequest {
  recipient: Hex
  /** Their kind-0. Needed for the lightning address, so the caller must have it already. */
  profile: Profile
  /** Set when zapping a note. */
  event?: NostrEvent
  amountSats: number
  comment?: string
  signer: Signer
  /** From `useNwcClient()`. Undefined falls through to WebLN inside `payInvoice`. */
  client: NwcClient | undefined
}

export async function sendZap(request: ZapRequest): Promise<ZapResult> {
  const { recipient, profile, event, amountSats, comment, signer, client } = request

  const built = await createZapInvoice({
    target: {
      recipientPubkey: recipient,
      amountMsat: amountSats * 1_000,
      // Where the recipient should look for the receipt: our own read set.
      relays: [...DEFAULT_RELAYS],
      ...(comment === undefined || comment.trim() === '' ? {} : { comment: comment.trim() }),
      ...(event === undefined ? {} : { eventId: event.id }),
    },
    recipient: profile,
    signer,
  })

  // Nothing was paid at this stage.
  if (!built.ok) return { ok: false, stage: 'invoice', message: built.error.message, refused: true }

  /* Hand the wallet the zap request, so its own history can say who this went. */
  const paid = await payInvoice(
    client,
    built.value.bolt11,
    built.value.zap ? { nostr: built.value.zapRequest } : undefined,
  )
  if (!paid.ok) return { ok: false, stage: 'payment', message: paid.message, refused: paid.refused }

  return {
    ok: true,
    preimage: paid.preimage,
    via: paid.via,
    zap: built.value.zap,
    verified: built.value.zap ? built.value.verified : false,
  }
}

/** Whether there is anywhere to send sats at all. */
export function canReceiveZaps(profile: Profile | null | undefined): boolean {
  return profile !== null && profile !== undefined && zapEndpointUrl(profile) !== null
}

/** What to put in front of the reader when a zap did not go. */
export function paymentFailureText(result: { message: string; refused: boolean }): string {
  if (result.refused) return result.message
  return `${result.message} Your wallet did not confirm either way, so check its history before sending again, this may already have been paid.`
}

/* THERE IS NO "not a zap" NOTICE ANY MORE. */
