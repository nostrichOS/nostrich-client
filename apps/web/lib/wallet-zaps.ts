'use client'

import { useMemo } from 'react'
import { zapRequestFromInvoiceDescription, zappedEventId, type Hex } from '@nostrich/nostr'

import { useWalletLedger, type WalletPayment } from './wallet-ledger'
import type { ZapDetail } from './interactions'
import type { ZapEntry } from './profile-zaps'

/** ZAPS RECOVERED FROM THE MONEY, for notes the reader wrote. */

/** A zap the wallet knows about, with the key that identifies it across sources. */
export interface WalletZap extends ZapDetail {
  /** The note. */
  noteId: string
  /** The signed zap request's id. */
  requestId: string
}

/** Every zap in a wallet's incoming history, keyed by note. */
export function walletZapsByNote(payments: readonly WalletPayment[]): Map<string, WalletZap[]> {
  const out = new Map<string, WalletZap[]>()
  for (const payment of payments) {
    if (!payment.incoming) continue
    const request = zapRequestFromInvoiceDescription(payment.description)
    if (request === null) continue
    const noteId = zappedEventId(request)
    // A zap to the person rather than to a note.
    if (noteId === undefined) continue
    const comment = request.content.trim()
    const zap: WalletZap = {
      noteId,
      requestId: request.id,
      sender: request.pubkey as Hex,
      // The settled payment, not the request's claim about itself.
      sats: payment.sats,
      at: payment.at,
      ...(comment === '' ? {} : { comment }),
    }
    out.set(noteId, [...(out.get(noteId) ?? []), zap])
  }
  return out
}

/** Wallet zaps for one note, minus the ones already known from relays. */
export function mergeWalletZaps(
  known: readonly ZapDetail[],
  fromWallet: readonly WalletZap[],
  noteId: string,
): ZapDetail[] {
  if (fromWallet.length === 0) return [...known]
  const seen = new Set(known.map(zap => zap.requestId).filter((id): id is string => id !== undefined))
  const extra = fromWallet.filter(zap => zap.noteId === noteId && !seen.has(zap.requestId))
  if (extra.length === 0) return [...known]
  return [...known, ...extra].sort((a, b) => b.at - a.at)
}

/** @param active Whether anything on screen is actually reading. */
export function useWalletZaps(
  viewer: Hex | undefined,
  noteAuthor: Hex | undefined,
  active: boolean,
): WalletZap[] {
  // Only the author's own wallet can say anything about their own note.
  const mine = viewer !== undefined && viewer === noteAuthor
  const ledger = useWalletLedger(viewer, active && mine)
  return useMemo(() => {
    if (!mine) return EMPTY
    const byNote = walletZapsByNote(ledger.incoming)
    return [...byNote.values()].flat()
  }, [ledger.incoming, mine])
}

const EMPTY: WalletZap[] = []

/** ZAPS THE RELAYS NEVER ANNOUNCED, for the Received tab. */
export function zapEntriesFromPayments(payments: readonly WalletPayment[]): ZapEntry[] {
  const out: ZapEntry[] = []
  for (const payment of payments) {
    if (!payment.incoming) continue
    const request = zapRequestFromInvoiceDescription(payment.description)
    if (request === null) continue
    const comment = request.content.trim()
    const noteId = zappedEventId(request)
    out.push({
      // Distinct from a receipt's id, which this payment does not have and may never get.
      id: `wallet:${request.id}`,
      counterparty: request.pubkey as Hex,
      // The settled payment, never the request's claim about itself.
      sats: payment.sats,
      createdAt: payment.at,
      senderVerified: true,
      requestId: request.id,
      ...(comment === '' ? {} : { comment }),
      ...(noteId === undefined ? {} : { eventId: noteId as Hex }),
      ...(payment.paymentHash === undefined ? {} : { paymentHash: payment.paymentHash }),
      ...(payment.descriptionHash === undefined ? {} : { descriptionHash: payment.descriptionHash }),
    })
  }
  return out
}

/** True when a payment carries a zap, so the caller can leave it out. */
export function isZapPayment(payment: WalletPayment): boolean {
  return payment.incoming && zapRequestFromInvoiceDescription(payment.description) !== null
}

/** The promoted zaps that are not already on the relay list. */
export function newZapsFromWallet(
  known: readonly ZapEntry[],
  fromWallet: readonly ZapEntry[],
): ZapEntry[] {
  const seen = new Set(known.map(zap => zap.requestId).filter((id): id is string => id !== undefined))
  return fromWallet.filter(zap => zap.requestId === undefined || !seen.has(zap.requestId))
}
