'use client'

import { useQuery } from '@tanstack/react-query'
import { decodeBolt11, type Hex, type NwcTransaction } from '@nostrich/nostr'

import type { ZapEntry } from './profile-zaps'
import { useNwcClient, useWallet } from './wallet'

/** What the connected wallet says it was paid, beside what Nostr says it was zapped. */

export interface WalletPayment {
  /** Stable within a list: the payment hash, else the invoice, else the position. */
  id: string
  sats: number
  description?: string
  /** Seconds. `settled_at` when the wallet reports it, else when the invoice was made. */
  at: number
  incoming: boolean
  paymentHash?: string
  descriptionHash?: string
}

export interface WalletLedger {
  incoming: WalletPayment[]
  outgoing: WalletPayment[]
  loading: boolean
  /** Whether the wallet answered at all. */
  supported: boolean
  /** Whether there is a wallet at all. */
  connected: boolean
}

const NONE: WalletPayment[] = []

/** Enough history to cover what a reader would scroll, without paging a wallet. */
const LIMIT = 50

function toPayment(tx: NwcTransaction, index: number): WalletPayment {
  const invoice = tx.invoice === undefined ? null : decodeBolt11(tx.invoice)
  const paymentHash = tx.paymentHash ?? invoice?.paymentHash
  const descriptionHash = tx.descriptionHash ?? invoice?.descriptionHash
  const description = tx.description ?? invoice?.description
  return {
    id: paymentHash ?? tx.invoice ?? `${tx.type}-${index}`,
    sats: Math.round(tx.amountMsat / 1000),
    ...(description === undefined || description.trim() === '' ? {} : { description }),
    at: tx.settledAt ?? tx.createdAt ?? 0,
    incoming: tx.type === 'incoming',
    ...(paymentHash === undefined ? {} : { paymentHash }),
    ...(descriptionHash === undefined ? {} : { descriptionHash }),
  }
}

/** True when this payment is a zap already in the list beside. */
export function paidByZap(payment: WalletPayment, zaps: readonly ZapEntry[]): boolean {
  if (payment.paymentHash === undefined && payment.descriptionHash === undefined) return false
  return zaps.some(
    zap =>
      (payment.paymentHash !== undefined && zap.paymentHash === payment.paymentHash) ||
      (payment.descriptionHash !== undefined && zap.descriptionHash === payment.descriptionHash),
  )
}

/** Everything the wallet received that the zap list does not already account. */
export function unzappedIncome(
  ledger: WalletLedger,
  zaps: readonly ZapEntry[],
): WalletPayment[] {
  return ledger.incoming.filter(payment => !paidByZap(payment, zaps))
}

/** @param active Whether the tab reading this is the one on screen. */
export function useWalletLedger(pubkey: Hex | undefined, active: boolean): WalletLedger {
  const client = useNwcClient(pubkey)
  /** THE WALLET, not just the account, is part of this list's identity. */
  const wallet = useWallet(pubkey).connection?.walletPubkey

  const query = useQuery({
    queryKey: ['wallet-ledger', pubkey ?? '', wallet ?? ''],
    queryFn: async (): Promise<{ payments: WalletPayment[]; supported: boolean }> => {
      if (client === undefined) return { payments: [], supported: false }
      const result = await client.listTransactions({ limit: LIMIT })
      // A wallet that does not implement the method answers with an error, not an empty list.
      if (!result.ok) return { payments: [], supported: false }
      return { payments: result.value.map(toPayment), supported: true }
    },
    enabled: active && client !== undefined,
    /* A minute. */
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })

  const payments = query.data?.payments ?? NONE
  return {
    incoming: payments.filter(payment => payment.incoming),
    outgoing: payments.filter(payment => !payment.incoming),
    loading: query.isPending && active && client !== undefined,
    supported: query.data?.supported ?? false,
    connected: client !== undefined,
  }
}
