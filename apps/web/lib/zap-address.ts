'use client'

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  KINDS,
  resolveZapEndpoint,
  type Hex,
  type NostrEvent,
  type Profile,
  type Signer,
} from '@nostrich/nostr'

import { getPool } from './pool'
import { forgetCachedProfile } from './profile-cache'

/** Pointing your profile's lightning address at the wallet you just connected. */

export type SetAddressResult = { ok: true } | { ok: false; message: string }

/** What the profile read established, and whether it is safe to write on top. */
export type ProfileBase =
  | { ok: true; content: Record<string, unknown>; previousAt: number }
  | { ok: false; message: string }

export function profileBaseFor(answered: number, events: readonly NostrEvent[]): ProfileBase {
  if (answered === 0) {
    return {
      ok: false,
      message: 'Could not reach your relays, so nothing was changed. Try again in a moment.',
    }
  }
  const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0]
  if (newest === undefined) {
    return {
      ok: false,
      message: 'No profile found to update. Set your address in Edit profile instead.',
    }
  }
  let content: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(newest.content)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, message: 'Your profile could not be read, so nothing was changed.' }
    }
    content = parsed as Record<string, unknown>
  } catch {
    return { ok: false, message: 'Your profile could not be read, so nothing was changed.' }
  }
  return { ok: true, content, previousAt: newest.created_at }
}

export async function setLightningAddress(
  pubkey: Hex,
  signer: Signer,
  address: string,
): Promise<SetAddressResult> {
  let base: ProfileBase
  try {
    const outcome = await getPool().queryWithStatus(
      [{ kinds: [KINDS.metadata], authors: [pubkey], limit: 1 }],
      undefined,
      6_000,
    )
    base = profileBaseFor(outcome.answered, outcome.events)
  } catch {
    return { ok: false, message: 'Could not read your current profile, so nothing was changed.' }
  }
  if (!base.ok) return base

  const content = base.content
  const previousAt = base.previousAt

  content['lud16'] = address

  try {
    const signed = await signer.signEvent({
      kind: KINDS.metadata,
      // A replaceable event published in the same second as the last one is silently.
      created_at: Math.max(Math.floor(Date.now() / 1000), previousAt + 1),
      tags: [],
      content: JSON.stringify(content),
    })
    const results = await getPool().publish(signed)
    if (!results.some(result => result.ok)) {
      return { ok: false, message: 'No relay accepted the change. Your address is unchanged.' }
    }
    return { ok: true }
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : 'Signing was cancelled.' }
  }
}

const DISMISSED_KEY = 'nostrich:zap-address-dismissed'
/** Addresses already published from here. */
const APPLIED_KEY = 'nostrich:zap-address-applied'

function readList(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, JSON.stringify([...readList(key), value].slice(-20)))
  } catch {
    // Private mode: the offer may come back next session, which is the harmless direction.
  }
}

/** TWO ADDRESSES CAN BE ONE WALLET, and comparing the strings cannot tell. */
export type Destination =
  | 'same'
  /** They resolve to different wallets. */
  | 'different'
  /** Not resolvable: a provider that is down, or one that sends no CORS header. */
  | 'unknown'
  | 'pending'

/** LUD-16 `name@host` or a bech32 LUD-06 string, in the field the resolver reads. */
function recipientFor(address: string): Pick<Profile, 'lud16' | 'lud06'> {
  const value = address.trim()
  return value.toLowerCase().startsWith('lnurl1') ? { lud06: value.toLowerCase() } : { lud16: value }
}

export function useDestination(a: string | undefined, b: string | undefined): Destination {
  const left = a?.trim() ?? ''
  const right = b?.trim() ?? ''
  // Only worth a request when the strings already disagree.
  const enabled = left !== '' && right !== '' && left.toLowerCase() !== right.toLowerCase()

  const query = useQuery({
    queryKey: ['zap-destination', left.toLowerCase(), right.toLowerCase()],
    enabled,
    // A wallet's callback is not something that changes between page views.
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<Destination> => {
      const [one, two] = await Promise.all([
        resolveZapEndpoint(recipientFor(left)),
        resolveZapEndpoint(recipientFor(right)),
      ])
      if (!one.ok || !two.ok) return 'unknown'
      return one.value.callback === two.value.callback ? 'same' : 'different'
    },
  })

  if (!enabled) return 'different'
  return query.data ?? (query.isPending ? 'pending' : 'unknown')
}

/** Whether to interrupt somebody, as a pure function of what is known. */
export function shouldOffer(input: {
  /** A key that can sign the change, and somebody to sign. */
  hasIdentity: boolean
  walletAddress: string | undefined
  currentAddress: string | undefined
  destination: Destination
  dismissed: readonly string[]
  applied: readonly string[]
  done: boolean
}): boolean {
  const wallet = input.walletAddress?.trim().toLowerCase() ?? ''
  if (!input.hasIdentity || wallet === '' || input.done) return false
  if (input.dismissed.includes(wallet) || input.applied.includes(wallet)) return false
  if (wallet === (input.currentAddress?.trim().toLowerCase() ?? '')) return false
  // `pending` holds the banner back for the length of one lookup rather than showing.
  return input.destination !== 'same' && input.destination !== 'pending'
}

export interface ZapAddressOffer {
  /** The address to offer, or undefined when there is nothing to say. */
  address: string | undefined
  /** What the profile says today, for the copy that explains the swap. */
  current: string | undefined
  apply: () => Promise<void>
  dismiss: () => void
  busy: boolean
  done: boolean
  error: string | undefined
}

/** Whether to offer, and the two actions. */
export function useZapAddressOffer({
  pubkey,
  signer,
  walletAddress,
  currentAddress,
}: {
  pubkey: Hex | undefined
  signer: Signer | undefined
  /** From the NWC string's `lud16` parameter. */
  walletAddress: string | undefined
  /** From the reader's own kind-0. */
  currentAddress: string | undefined
}): ZapAddressOffer {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState<string[]>(() => readList(DISMISSED_KEY))
  const [applied, setApplied] = useState<string[]>(() => readList(APPLIED_KEY))

  const normalised = walletAddress?.trim().toLowerCase()
  const destination = useDestination(walletAddress, currentAddress)
  const offerable = shouldOffer({
    hasIdentity: pubkey !== undefined && signer !== undefined,
    walletAddress,
    currentAddress,
    destination,
    dismissed,
    applied,
    done,
  })

  const apply = useCallback(async (): Promise<void> => {
    if (pubkey === undefined || signer === undefined || walletAddress === undefined) return
    setBusy(true)
    setError(undefined)
    const result = await setLightningAddress(pubkey, signer, walletAddress.trim())
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setDone(true)
    /* THE OFFER CAME BACK. */
    forgetCachedProfile(pubkey)
    await queryClient.invalidateQueries({ queryKey: ['profile', pubkey] })
    // Remembered so the offer stays gone even while a relay is still catching up.
    remember(APPLIED_KEY, walletAddress.trim().toLowerCase())
    setApplied(applied => [...applied, walletAddress.trim().toLowerCase()])
  }, [pubkey, queryClient, signer, walletAddress])

  const dismiss = useCallback((): void => {
    if (normalised === undefined) return
    setDismissed(current => [...current, normalised])
    remember(DISMISSED_KEY, normalised)
  }, [normalised])

  return {
    address: offerable ? walletAddress?.trim() : undefined,
    current: currentAddress,
    apply,
    dismiss,
    busy,
    done,
    error,
  }
}
