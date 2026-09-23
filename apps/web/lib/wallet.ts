'use client'

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  createNwcClient,
  parseWalletConnectUri,
  walletConnectRelays,
  type NwcClient,
  type WalletConnection,
  type Hex,
  type RelayUrl,
} from '@nostrich/nostr'

import { getPool } from './pool'
import { onScopedChange, readScoped, writeScoped } from './scope'
import { readStoredAccounts } from './session-storage'
import { ZAP_AMOUNT_KEY as AMOUNT_KEY, ZAP_PRESETS_KEY as PRESETS_KEY } from './settings-keys'

/** The reader's lightning wallet. */

/** ONE WALLET PER ACCOUNT, and the reason it is not one per browser. */
const KEY_PREFIX = 'nostrich:wallet:v1'
/** The pre-account key. */
const LEGACY_KEY = 'nostrich:wallet:v1'

function keyFor(pubkey: Hex | undefined): string {
  return pubkey === undefined ? `${KEY_PREFIX}:none` : `${KEY_PREFIX}:${pubkey}`
}

export interface WalletState {
  /** Parsed connection, or undefined when no wallet is connected. */
  connection: WalletConnection | undefined
  /** The raw URI, kept so the reader can copy it back out or re-inspect what they pasted. */
  uri: string | undefined
}

const EMPTY: WalletState = { connection: undefined, uri: undefined }

function load(pubkey: Hex | undefined): WalletState {
  if (typeof window === 'undefined') return EMPTY
  try {
    const uri = localStorage.getItem(keyFor(pubkey)) ?? migrateLegacy(pubkey)
    if (uri === null || uri === '') return EMPTY
    const parsed = parseWalletConnectUri(uri)
    // A stored string that no longer parses is treated as no wallet rather.
    if (!parsed.ok) return EMPTY
    return { connection: parsed.value, uri }
  } catch {
    return EMPTY
  }
}

/** One entry per account, filled on demand. */
const cache = new Map<string, WalletState>()
const listeners = new Set<() => void>()
let version = 0

function stateFor(pubkey: Hex | undefined): WalletState {
  if (typeof window === 'undefined') return EMPTY
  const key = keyFor(pubkey)
  let entry = cache.get(key)
  if (entry === undefined) {
    entry = load(pubkey)
    cache.set(key, entry)
  }
  return entry
}

function snapshot(): number {
  return version
}

function serverSnapshot(): number {
  return 0
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  version += 1
  for (const listener of listeners) listener()
}

/** The zap presets and the default amount are per account too. */
onScopedChange(base => {
  if (base === undefined || base === PRESETS_KEY || base === AMOUNT_KEY) emit()
})

export type ConnectResult = { ok: true } | { ok: false; message: string }

export function connectWallet(pubkey: Hex | undefined, uri: string): ConnectResult {
  const trimmed = uri.trim()
  const parsed = parseWalletConnectUri(trimmed)
  if (!parsed.ok) {
    return {
      ok: false,
      // The library's own message names the exact defect.
      message: parsed.error.message,
    }
  }
  cache.set(keyFor(pubkey), { connection: parsed.value, uri: trimmed })
  try {
    localStorage.setItem(keyFor(pubkey), trimmed)
  } catch {
    // Private mode.
  }
  emit()
  return { ok: true }
}

export function disconnectWallet(pubkey: Hex | undefined): void {
  cache.set(keyFor(pubkey), EMPTY)
  try {
    localStorage.removeItem(keyFor(pubkey))
    // The pre-account copy goes with it, or it would be re-migrated on the next load.
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // Nothing to clean up.
  }
  emit()
}

/** Throw away what is cached in memory and read the disk again. */
export function forgetWalletCache(): void {
  cache.clear()
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) forgetWalletCache()
  })
}

/** The connection for one account, without a hook. */
export function readWallet(pubkey: Hex | undefined): WalletState {
  return stateFor(pubkey)
}

export function useWallet(pubkey: Hex | undefined): WalletState {
  useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  return stateFor(pubkey)
}

/** The pre-account connection, moved to its owner. */
function migrateLegacy(pubkey: Hex | undefined): string | null {
  if (pubkey === undefined) return null
  let legacy: string | null
  try {
    legacy = localStorage.getItem(LEGACY_KEY)
  } catch {
    return null
  }
  if (legacy === null || legacy === '') return null

  const accounts = readStoredAccounts().accounts
  try {
    localStorage.removeItem(LEGACY_KEY)
    if (accounts.length > 1) return null
    localStorage.setItem(keyFor(pubkey), legacy)
  } catch {
    // Private mode.
  }
  return accounts.length > 1 ? null : legacy
}

/** An NWC client for the connected wallet, or undefined. */
export function useNwcClient(pubkey: Hex | undefined): NwcClient | undefined {
  const { connection, uri } = useWallet(pubkey)

  /** The wallet's relay is opened as soon as a wallet is configured, not when Zap. */
  const walletRelays = uri === undefined ? undefined : walletConnectRelays(uri)
  const warmKey = walletRelays?.join(',') ?? ''
  useEffect(() => {
    if (warmKey === '') return
    void getPool().warm(warmKey.split(',') as RelayUrl[])
  }, [warmKey])

  return useMemo(() => {
    if (connection === undefined || uri === undefined) return undefined
    try {
      return createNwcClient({
        connection,
        pool: getPool(),
        relays: walletConnectRelays(uri),
      })
    } catch {
      // Only thrown for a connection that could never work, which `load` already filters.
      return undefined
    }
  }, [connection, uri])
}

/** The wallet's balance, cached on disk and refreshed behind whatever is on screen. */
const BALANCE_KEY = 'wallet-balance'

/** Old enough to be worth refusing on, young enough not to refuse a wallet. */
const BALANCE_MAX_MS = 12 * 60 * 60_000

/** The connection's spending allowance, when the wallet reports one. */
export function useWalletBudget(pubkey: Hex | undefined): {
  usedMsat: number
  totalMsat: number
} | undefined {
  const client = useNwcClient(pubkey)
  const { connection } = useWallet(pubkey)
  const wallet = connection?.walletPubkey

  const query = useQuery({
    queryKey: ['wallet-budget', pubkey ?? '', wallet ?? ''],
    queryFn: async (): Promise<{ usedMsat: number; totalMsat: number } | null> => {
      if (client === undefined) return null
      const methods = await client.advertisedMethods()
      if (methods !== undefined && !methods.includes('get_budget')) return null
      const res = await client.getBudget()
      // A refusal is an answer: this connection has no budget.
      if (!res.ok) return null
      return { usedMsat: res.value.usedMsat, totalMsat: res.value.totalMsat }
    },
    enabled: client !== undefined && (pubkey ?? '') !== '',
    staleTime: 60_000,
    gcTime: 30 * 60_000,
  })

  const data = query.data
  return data === null || data === undefined || data.totalMsat <= 0 ? undefined : data
}

export function useWalletBalance(pubkey: Hex | undefined): {
  balanceMsat: number | undefined
  loading: boolean
  /** True when the figure is the last one we stored rather than one the wallet just gave. */
  stale: boolean
} {
  const client = useNwcClient(pubkey)
  const { connection } = useWallet(pubkey)
  const key = pubkey ?? ''
  /* The WALLET is part of the identity of this figure, not just the account. */
  const wallet = connection?.walletPubkey

  const query = useQuery({
    queryKey: ['wallet-balance', key, wallet ?? ''],
    queryFn: async (): Promise<number> => {
      if (client === undefined) throw new Error('no wallet connected')
      const res = await client.getBalance()
      /* THROWS rather than returning undefined. */
      if (!res.ok) throw new Error(res.error.code)
      writeScoped(
        BALANCE_KEY,
        JSON.stringify({ msat: res.value.balanceMsat, at: Date.now(), wallet }),
      )
      return res.value.balanceMsat
    },
    enabled: client !== undefined && key !== '',
    // Re-read per render, not captured at mount.
    placeholderData: () => storedBalance(wallet),
    staleTime: 60_000,
    gcTime: 30 * 60_000,
  })

  /* A figure the wallet actually produced this session is fresh. */
  const stale = !query.isSuccess && query.data !== undefined
  return {
    balanceMsat: query.data,
    loading: query.isPending && !stale && client !== undefined,
    stale,
  }
}

/** The last balance this browser saw FOR THIS WALLET, or undefined. */
export function storedBalance(wallet: string | undefined): number | undefined {
  if (wallet === undefined) return undefined
  const raw = readScoped(BALANCE_KEY)
  if (raw === null) return undefined
  try {
    const held = JSON.parse(raw) as { msat?: unknown; at?: unknown; wallet?: unknown }
    if (typeof held.msat !== 'number' || typeof held.at !== 'number') return undefined
    // Written before this field existed, or written by a different wallet.
    if (held.wallet !== wallet) return undefined
    return Date.now() - held.at < BALANCE_MAX_MS ? held.msat : undefined
  } catch {
    return undefined
  }
}

/** THE WALLET'S OWN NAME, ASKED ONCE PER WALLET RATHER THAN ONCE PER VISIT. */
const ALIAS_KEY = 'wallet-alias'

export function storedAlias(wallet: string | undefined): string | undefined {
  if (wallet === undefined) return undefined
  const raw = readScoped(ALIAS_KEY)
  if (raw === null) return undefined
  try {
    const held = JSON.parse(raw) as { alias?: unknown; wallet?: unknown }
    if (typeof held.alias !== 'string' || held.alias === '') return undefined
    // Written by a different wallet, or before this field existed.
    return held.wallet === wallet ? held.alias : undefined
  } catch {
    return undefined
  }
}

export function useWalletAlias(pubkey: Hex | undefined): string | undefined {
  const client = useNwcClient(pubkey)
  const { connection } = useWallet(pubkey)
  const wallet = connection?.walletPubkey

  const query = useQuery({
    queryKey: ['wallet-alias', pubkey ?? '', wallet ?? ''],
    queryFn: async (): Promise<string | null> => {
      if (client === undefined) return null
      const info = await client.getInfo()
      if (!info.ok) return null
      const alias = info.value.alias
      if (alias === undefined || alias === '') return null
      writeScoped(ALIAS_KEY, JSON.stringify({ alias, wallet }))
      return alias
    },
    enabled: client !== undefined && (pubkey ?? '') !== '',
    // Re-read per render rather than captured at mount.
    placeholderData: () => storedAlias(wallet) ?? null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 24 * 60 * 60_000,
  })

  return query.data ?? undefined
}

/** Whether this zap is knowably too big for the wallet. */
export function knownInsufficient(amountSats: number, wallet: string | undefined): boolean {
  const held = storedBalance(wallet)
  return held !== undefined && amountSats * 1_000 > held
}

// --------------------------------------------------------------------------- WebLN.

interface WebLnProvider {
  enable(): Promise<void>
  sendPayment(invoice: string): Promise<{ preimage: string }>
}

function webln(): WebLnProvider | undefined {
  if (typeof window === 'undefined') return undefined
  const provider = (window as { webln?: WebLnProvider }).webln
  return typeof provider?.sendPayment === 'function' ? provider : undefined
}

export function hasWebln(): boolean {
  return webln() !== undefined
}

export type PayResult =
  | { ok: true; preimage: string; via: 'nwc' | 'webln' }
  | {
      ok: false
      message: string
      /** True when the WALLET ITSELF said no, so nothing was spent. */
      refused: boolean
    }

/** Pay a bolt11, preferring the connected wallet. */
export async function payInvoice(
  client: NwcClient | undefined,
  invoice: string,
  /** What the payment. */
  metadata?: Record<string, unknown>,
): Promise<PayResult> {
  if (client !== undefined) {
    try {
      const result = await client.payInvoice({
        invoice,
        ...(metadata === undefined ? {} : { metadata }),
      })
      if (result.ok) return { ok: true, preimage: result.value.preimage, via: 'nwc' }
      /* WHETHER THE WALLET ACTUALLY SAID NO IS PART OF THE ANSWER. */
      return { ok: false, message: result.error.message, refused: result.error.fromWallet }
    } catch (error) {
      // An exception is this side failing, so the wallet's verdict is likewise unknown.
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'The wallet did not answer.',
        refused: false,
      }
    }
  }

  const provider = webln()
  if (provider !== undefined) {
    try {
      await provider.enable()
      const result = await provider.sendPayment(invoice)
      return { ok: true, preimage: result.preimage, via: 'webln' }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'The extension refused the payment.',
        /* An extension answers in-process, so a rejected promise IS its verdict. */
        refused: true,
      }
    }
  }

  return { ok: false, message: 'No wallet is connected.', refused: true }
}

// --------------------------------------------------------------------------- Default.

/** Sats. Small enough to send without thinking, which is the point of a one-tap zap. */
export const DEFAULT_ZAP_SATS = 21

/** One button in the zap picker. */
export interface ZapPreset {
  sats: number
  label?: string
  /** What the amount. */
  name?: string
}

/** Sats that mean something on Nostr. */
export const DEFAULT_ZAP_PRESETS: ZapPreset[] = [
  { sats: 21, label: '⚡', name: 'spark' },
  { sats: 42, label: '🙂', name: 'nice' },
  { sats: 100, label: '👍', name: 'thanks' },
  { sats: 210, label: '🔥', name: 'fire' },
  { sats: 500, label: '☕', name: 'coffee' },
  { sats: 1_000, label: '🚀', name: 'boost' },
  { sats: 2_100, label: '💜', name: 'love' },
  { sats: 5_000, label: '🍕', name: 'dinner' },
  { sats: 21_000, label: '🧡', name: 'legend' },
]

/** Nine fills three rows of three. */
export const MAX_ZAP_PRESETS = 12

export function readZapPresets(): ZapPreset[] {
  if (typeof window === 'undefined') return DEFAULT_ZAP_PRESETS
  try {
    const raw = readScoped(PRESETS_KEY)
    if (raw === null) return DEFAULT_ZAP_PRESETS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_ZAP_PRESETS
    const out: ZapPreset[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as { sats?: unknown; label?: unknown; name?: unknown }
      if (!Number.isInteger(record.sats) || (record.sats as number) <= 0) continue
      const label = typeof record.label === 'string' ? record.label.trim().slice(0, 16) : ''
      const name = typeof record.name === 'string' ? record.name.trim().slice(0, 14) : ''
      out.push({
        sats: record.sats as number,
        ...(label === '' ? {} : { label }),
        ...(name === '' ? {} : { name }),
      })
    }
    // An empty stored list is a picker with no buttons, which is a broken screen rather.
    return out.length === 0 ? DEFAULT_ZAP_PRESETS : out.slice(0, MAX_ZAP_PRESETS)
  } catch {
    return DEFAULT_ZAP_PRESETS
  }
}

export function writeZapPresets(presets: readonly ZapPreset[]): void {
  writeScoped(PRESETS_KEY, JSON.stringify(presets.slice(0, MAX_ZAP_PRESETS)))
  emit()
}

export function useZapPresets(): [ZapPreset[], (presets: readonly ZapPreset[]) => void] {
  useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const value = typeof window === 'undefined' ? DEFAULT_ZAP_PRESETS : readZapPresets()
  return [value, writeZapPresets]
}

export function readDefaultZap(): number {
  if (typeof window === 'undefined') return DEFAULT_ZAP_SATS
  const raw = Number(readScoped(AMOUNT_KEY))
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_ZAP_SATS
}

export function useDefaultZap(): [number, (sats: number) => void] {
  useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const value = typeof window === 'undefined' ? DEFAULT_ZAP_SATS : readDefaultZap()

  const set = useCallback((sats: number): void => {
    if (!Number.isInteger(sats) || sats <= 0) return
    writeScoped(AMOUNT_KEY, String(sats))
    emit()
  }, [])

  return [value, set]
}

/** A NAME FOR THE WALLET THAT DOES NOT NEED THE WALLET TO ANSWER. */
export function providerLabel(address: string | undefined): string | undefined {
  if (address === undefined) return undefined
  const at = address.lastIndexOf('@')
  if (at <= 0) return undefined
  const labels = address
    .slice(at + 1)
    .toLowerCase()
    .split('.')
    .filter(part => part !== '')
  // Two labels or more: the one before the public suffix.
  const name = labels.length >= 2 ? labels[labels.length - 2] : labels[0]
  if (name === undefined || name === '') return undefined
  return name.charAt(0).toUpperCase() + name.slice(1)
}
