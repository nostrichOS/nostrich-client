'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  NUTZAP_KIND,
  decodeBolt11,
  parseNutzap,
  resolveZapEndpoint,
  validateZapReceipt,
  zapRequestOfReceipt,
  type Hex,
  type NostrEvent,
  type Profile,
  type ZapReceipt,
} from '@nostrich/nostr'

import { getPool } from './pool'
import { zapRelays } from './zap-relays'
import { profileQuery } from './profiles'

/** Zaps an account sent and received. */

const ZAP_RECEIPT = 9735

/** Twelve seconds, not eight. */
const TIMEOUT_MS = 12_000

/** Receipts per request, and how many requests. */
/** How old a stored answer may be and still be shown while a fresh one is counted. */
const CACHE_MAX_MS = 6 * 60 * 60_000

/** Entries kept per direction. */
const CACHE_ENTRIES = 100

/** Exactly what the query returns, minus the entries beyond `CACHE_ENTRIES`. */
interface ZapPage {
  received: ZapEntry[]
  sent: ZapEntry[]
  receivedTotal: number | undefined
  sentTotal: number | undefined
  unverifiable: boolean
}

const PAGE_SIZE = 500
const MAX_PAGES = 6

/** Every receipt matching a filter, oldest page last. */
export async function pageReceipts(tag: '#p' | '#P', pubkey: Hex): Promise<NostrEvent[]> {
  const seen = new Map<string, NostrEvent>()
  let until: number | undefined

  /* How many relays have to have spoken before a short page counts as the end of history. */
  const QUORUM = 2

  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Lightning receipts and ecash nutzaps: both are money somebody sent.
    const filter: Record<string, unknown> = { kinds: [ZAP_RECEIPT, NUTZAP_KIND], [tag]: [pubkey], limit: PAGE_SIZE }
    if (until !== undefined) filter.until = until
    /* `graceMs: 0`. */
    // Widened for receipts only.
    const outcome = await getPool().queryWithStatus([filter as never], zapRelays(), TIMEOUT_MS, {
      graceMs: 0,
    })
    const batch = outcome.events

    /** Silence is not zero, and this is the difference between a number and a lie. */
    if (page === 0 && outcome.answered === 0) {
      throw new Error('no relay answered the zap query')
    }

    let fresh = 0
    let oldest = Number.POSITIVE_INFINITY
    for (const event of batch) {
      if (event.created_at < oldest) oldest = event.created_at
      if (seen.has(event.id)) continue
      seen.set(event.id, event)
      fresh += 1
    }
    /* A page ends the walk only when the NETWORK says there is no more, not when this one. */
    const heardEnough = outcome.answered >= Math.min(QUORUM, outcome.attempted)
    if (fresh === 0 || !Number.isFinite(oldest)) {
      if (heardEnough) break
      continue
    }
    until = oldest - 1
  }

  return [...seen.values()]
}

/** How many receipts the relays say exist, asked directly. */
export async function countReceipts(tag: '#p' | '#P', pubkey: Hex): Promise<number | undefined> {
  try {
    // Both kinds, or the headline reads "21 sats across 0 zaps" for an account paid.
    return await getPool().count(
      [{ kinds: [ZAP_RECEIPT, NUTZAP_KIND], [tag]: [pubkey] } as never],
      undefined,
      TIMEOUT_MS,
    )
  } catch {
    return undefined
  }
}

export interface ZapEntry {
  id: string
  /** The other party: who paid you, or who you paid. */
  counterparty: Hex
  sats: number
  comment?: string
  createdAt: number
  eventId?: Hex
  /** False when the receipt's sender is the LNURL server's word rather than proven. */
  senderVerified: boolean
  /** The invoice this zap paid, by its payment hash and the hash of its description. */
  paymentHash?: Hex
  descriptionHash?: Hex
  /** The signed zap REQUEST's id. */
  requestId?: string
}

const NONE: ZapEntry[] = []

function toEntry(receipt: ZapReceipt, counterparty: Hex, requestId?: string): ZapEntry {
  // One bech32 decode per receipt, and only for what the invoice already says.
  const invoice = decodeBolt11(receipt.bolt11)
  return {
    id: receipt.id,
    counterparty,
    sats: Math.round(receipt.amountMsat / 1000),
    ...(receipt.comment === undefined ? {} : { comment: receipt.comment }),
    createdAt: receipt.createdAt,
    ...(receipt.eventId === undefined ? {} : { eventId: receipt.eventId }),
    senderVerified: receipt.senderVerified,
    ...(invoice?.paymentHash === undefined ? {} : { paymentHash: invoice.paymentHash }),
    ...(invoice?.descriptionHash === undefined ? {} : { descriptionHash: invoice.descriptionHash }),
    ...(requestId === undefined ? {} : { requestId }),
  }
}

/** A zap this account SENT, read back out of the recipient's receipt. */
export function sentEntry(receipt: NostrEvent, payer: Hex): ZapEntry | null {
  const description = receipt.tags.find(tag => tag[0] === 'description')?.[1]
  const recipient = receipt.tags.find(tag => tag[0] === 'p')?.[1]
  if (description === undefined || recipient === undefined) return null
  let request: unknown
  try {
    request = JSON.parse(description)
  } catch {
    // Unparseable description.
    return null
  }
  if (typeof request !== 'object' || request === null) return null
  if ((request as NostrEvent).pubkey !== payer) return null

  const bolt11 = receipt.tags.find(tag => tag[0] === 'bolt11')?.[1] ?? ''
  const amount = amountFromBolt11(bolt11)
  if (amount === 0) return null

  /* THE SAME HASHES THE RECEIVED SIDE CARRIES, and for the same reason. */
  const invoice = decodeBolt11(bolt11)
  const comment = (request as NostrEvent).content?.trim()
  const target = receipt.tags.find(tag => tag[0] === 'e')?.[1]
  return {
    id: receipt.id,
    counterparty: recipient,
    sats: amount,
    ...(comment === undefined || comment === '' ? {} : { comment }),
    createdAt: receipt.created_at,
    ...(target === undefined ? {} : { eventId: target }),
    senderVerified: true,
    ...(invoice?.paymentHash === undefined ? {} : { paymentHash: invoice.paymentHash }),
    ...(invoice?.descriptionHash === undefined ? {} : { descriptionHash: invoice.descriptionHash }),
  }
}

export interface ProfileZaps {
  /** The rows we could fetch. */
  received: ZapEntry[]
  sent: ZapEntry[]
  receivedSats: number
  sentSats: number
  /** How many receipts EXIST, from the relays' own indexes rather than from counting rows. */
  receivedCount: number | undefined
  sentCount: number | undefined
  loading: boolean
  /** True when this account has no lightning address, so receipts cannot be checked. */
  unverifiable: boolean
  /** The relays could not be reached, so there is no figure. */
  failed: boolean
  /** Ask again. Nothing retries on its own: the query client sets `retry: false`. */
  retry: () => void
}

/** @param active Whether the Zaps tab is the one being looked. */
export function useProfileZaps(
  pubkey: Hex | undefined,
  _profile: Profile | null,
  active: boolean,
  /** WARMING, NOT SHOWING. */
  warm = false,
): ProfileZaps {
  const key = pubkey ?? ''
  const client = useQueryClient()

  const cached = (): ZapPage | undefined => undefined

  const query = useQuery({
    /** Keyed on the account and NOTHING else. */
    queryKey: ['profile-zaps', key],
    queryFn: async (): Promise<{
      received: ZapEntry[]
      sent: ZapEntry[]
      /** From NIP-45 COUNT, or undefined where no relay answers one. */
      receivedTotal: number | undefined
      sentTotal: number | undefined
      unverifiable: boolean
    }> => {
      if (pubkey === undefined)
        return { received: [], sent: [], receivedTotal: undefined, sentTotal: undefined, unverifiable: false }

      /** The COMPLETE profile, not the one the caller happens to be holding. */
      const profile = await client.ensureQueryData({
        ...profileQuery(pubkey),
        revalidateIfStale: true,
      })

      // The key their receipts must be signed.
      const endpoint = profile === null ? null : await resolveZapEndpoint(profile)

      /** "No lightning address" and "their server did not answer" are not the same fact. */
      if (endpoint !== null && !endpoint.ok && endpoint.error.code === 'lnurl-unreachable') {
        throw new Error(`lightning server unreachable: ${endpoint.error.message}`)
      }
      const lnurlPubkey = endpoint !== null && endpoint.ok ? endpoint.value.zapPubkey : undefined

      const [incoming, outgoing, receivedTotal, sentTotal] = await Promise.all([
        pageReceipts('#p', pubkey),
        // Uppercase P: the payer, when the server bothered to state.
        pageReceipts('#P', pubkey),
        // The figures.
        countReceipts('#p', pubkey),
        countReceipts('#P', pubkey),
      ])

      /* COUNTED IF IT VALIDATES. */
      const received: ZapEntry[] = []
      for (const event of incoming) {
        /* A NUTZAP NEEDS NO ISSUER, because there is no issuer to need. */
        if (event.kind === NUTZAP_KIND) {
          const nut = parseNutzap(event, pubkey)
          if (nut === undefined) continue
          received.push({
            id: nut.id,
            counterparty: nut.sender,
            sats: nut.amountSats,
            ...(nut.comment === '' ? {} : { comment: nut.comment }),
            createdAt: nut.createdAt,
            ...(nut.targetId === undefined ? {} : { eventId: nut.targetId as Hex }),
            // The payer signed the event itself.
            senderVerified: true,
          })
          continue
        }
        // `lnurlPubkey` is still passed when known: it is what SETS `issuerVerified`.
        const result = validateZapReceipt({
          receipt: event,
          ...(lnurlPubkey === undefined ? {} : { lnurlPubkey }),
          recipientPubkey: pubkey,
        })
        if (result.ok) {
          received.push(
            toEntry(result.value, result.value.senderPubkey, zapRequestOfReceipt(event)?.id),
          )
        }
      }

      /** Sent zaps are validated against the RECIPIENT's server, not ours. */
      const sent: ZapEntry[] = []
      const seen = new Set<string>()
      for (const event of outgoing) {
        if (seen.has(event.id)) continue
        seen.add(event.id)
        const entry = sentEntry(event, pubkey)
        if (entry !== null) sent.push(entry)
      }

      /* MERGED WITH WHAT WE ALREADY HAD, never replacing. */
      const previous = client.getQueryData<{ received: ZapEntry[]; sent: ZapEntry[] }>([
        'profile-zaps',
        key,
      ])
      const merge = (fresh: ZapEntry[], held: ZapEntry[] | undefined): ZapEntry[] => {
        const byId = new Map(held?.map(entry => [entry.id, entry]) ?? [])
        for (const entry of fresh) byId.set(entry.id, entry)
        return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
      }

      return {
        received: merge(received, previous?.received),
        sent: merge(sent, previous?.sent),
        receivedTotal,
        sentTotal,
        unverifiable: lnurlPubkey === undefined,
      }
    },
    // The profile no longer gates.
    enabled: active && key !== '',
    // Re-read on every render rather than captured at mount.
    placeholderData: cached,
    staleTime: 5 * 60_000,
    /* Cached figures paint instantly, then get checked. */
    // See `warm` on the signature: 'always' is for the screen, `staleTime`.
    refetchOnMount: warm ? false : 'always',
    gcTime: 30 * 60_000,
  })

  const { refetch } = query
  const retry = useCallback(() => {
    void refetch()
  }, [refetch])

  return useMemo(() => {
    const received = query.data?.received ?? NONE
    const sent = query.data?.sent ?? NONE
    return {
      received,
      sent,
      receivedSats: received.reduce((total, entry) => total + entry.sats, 0),
      sentSats: sent.reduce((total, entry) => total + entry.sats, 0),
      receivedCount: query.data?.receivedTotal,
      sentCount: query.data?.sentTotal,
      /** Three states, because there are three: we have an answer, we are getting one. */
      loading: active && key !== '' && query.data === undefined && !query.isError,
      unverifiable: query.data?.unverifiable ?? false,
      failed: query.isError && query.data === undefined,
      retry,
    }
  }, [query.data, query.isError, active, key, retry])
}

const AMOUNT_RE = /^lnbc(\d+)([munp])/i
const UNIT_DIV: Record<string, number> = { m: 1e3, u: 1e6, n: 1e9, p: 1e12 }

/** Sats from a bolt11 invoice. */
export function amountFromBolt11(bolt11: string): number {
  const match = AMOUNT_RE.exec(bolt11)
  if (match === null) return 0
  const raw = Number(match[1])
  const unit = match[2]?.toLowerCase()
  if (!Number.isFinite(raw) || unit === undefined) return 0
  const div = UNIT_DIV[unit]
  if (div === undefined) return 0
  return Math.round((raw / div) * 1e8)
}
