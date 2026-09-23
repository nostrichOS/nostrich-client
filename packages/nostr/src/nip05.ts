import type { Hex, Nip05Status, RelayUrl } from './types'

/** `local@domain`, plus the bare `domain` shorthand every client accepts as `_@domain`. */
const IDENTIFIER =
  /^(?:([a-z0-9\-_.]+)@)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i

const HEX64 = /^[0-9a-f]{64}$/

/** Verified lookups are stable for long stretches. */
const OK_TTL_MS = 60 * 60 * 1000
/** Negative caching matters more than positive: without it a dead domain is re-queried. */
const FAIL_TTL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 2000
const DEFAULT_TIMEOUT_MS = 5_000
/** A well-known document is a few hundred bytes. */
const MAX_DOC_CHARS = 256_000

export interface Nip05Identifier {
  /** Local part as written. `_` when the identifier was a bare domain. */
  name: string
  /** Lowercased hostname. */
  domain: string
  /** Canonical `name@domain`, for cache keys and storage. */
  identifier: string
}

export interface Nip05Resolution extends Nip05Identifier {
  /** Lowercase hex, as required everywhere internally. */
  pubkey: Hex
  /** Relay hints the document published for this pubkey. */
  relays: RelayUrl[]
  checkedAt: number
}

export interface Nip05Options {
  /** Injectable so tests and non-DOM platforms can supply their own transport. */
  fetch?: typeof fetch
  /** Default 5s. A slow well-known must never stall a feed row. */
  timeoutMs?: number
  /** Bypass the cache. */
  force?: boolean
}

interface CacheEntry {
  resolution: Nip05Resolution | null
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
/** Collapses the burst of identical lookups a feed fires while the same author scrolls. */
const inflight = new Map<string, Promise<Nip05Resolution | null>>()

export function parseNip05(identifier: string | undefined | null): Nip05Identifier | null {
  if (typeof identifier !== 'string') return null
  const match = IDENTIFIER.exec(identifier.trim())
  if (!match) return null
  const domain = match[2]
  if (domain === undefined) return null
  const name = match[1] ?? '_'
  const lowerDomain = domain.toLowerCase()
  return { name, domain: lowerDomain, identifier: `${name}@${lowerDomain}` }
}

/** True for anything we could actually look up. */
export function isNip05Identifier(identifier: string | undefined | null): boolean {
  return parseNip05(identifier) !== null
}

/** `_@example.com` is displayed as `example.com`. */
export function formatNip05(identifier: string | undefined | null): string {
  const parsed = parseNip05(identifier)
  if (!parsed) return typeof identifier === 'string' ? identifier : ''
  return parsed.name === '_' ? parsed.domain : `${parsed.name}@${parsed.domain}`
}

export function nip05Url(identifier: string | undefined | null): string | null {
  const parsed = parseNip05(identifier)
  if (!parsed) return null
  return `https://${parsed.domain}/.well-known/nostr.json?name=${encodeURIComponent(parsed.name)}`
}

/** Fetch and parse the well-known document. */
export async function resolveNip05(
  identifier: string | undefined | null,
  options: Nip05Options = {},
): Promise<Nip05Resolution | null> {
  const parsed = parseNip05(identifier)
  if (!parsed) return null

  // Case-folded key: we resolve names case-insensitively below, so case variants.
  const key = `${parsed.name.toLowerCase()}@${parsed.domain}`

  if (!options.force) {
    const hit = cache.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.resolution
    const pending = inflight.get(key)
    if (pending) return pending
  }

  const request = lookup(parsed, options)
    .then((resolution) => {
      remember(key, resolution)
      return resolution
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, request)
  return request
}

/** The whole point of NIP-05: the document must map the name back to the SAME pubkey. */
export async function verifyNip05(
  identifier: string | undefined | null,
  claimedPubkey: Hex,
  options: Nip05Options = {},
): Promise<Nip05Status> {
  const label = typeof identifier === 'string' ? identifier : ''
  const expected = claimedPubkey.toLowerCase()
  const resolution = await resolveNip05(identifier, options)
  const verified = resolution !== null && resolution.pubkey === expected
  return {
    identifier: label,
    verified,
    checkedAt: resolution?.checkedAt ?? Date.now(),
    // Relay hints are keyed by pubkey in the document.
    ...(verified && resolution.relays.length > 0 ? { relays: resolution.relays } : {}),
  }
}

/** Synchronous cache peek for the first paint. */
export function peekNip05(identifier: string | undefined | null, claimedPubkey: Hex): Nip05Status | null {
  const parsed = parseNip05(identifier)
  if (!parsed) return null
  const hit = cache.get(`${parsed.name.toLowerCase()}@${parsed.domain}`)
  if (!hit || hit.expiresAt <= Date.now()) return null
  const verified = hit.resolution !== null && hit.resolution.pubkey === claimedPubkey.toLowerCase()
  return {
    identifier: typeof identifier === 'string' ? identifier : parsed.identifier,
    verified,
    checkedAt: hit.resolution?.checkedAt ?? Date.now(),
    ...(verified && hit.resolution !== null && hit.resolution.relays.length > 0
      ? { relays: hit.resolution.relays }
      : {}),
  }
}

/** Drop one identifier, or the whole table. */
export function clearNip05Cache(identifier?: string): void {
  if (identifier === undefined) {
    cache.clear()
    return
  }
  const parsed = parseNip05(identifier)
  if (parsed) cache.delete(`${parsed.name.toLowerCase()}@${parsed.domain}`)
}

function remember(key: string, resolution: Nip05Resolution | null): void {
  // Delete-then-set moves the key to the end of the Map's insertion order.
  cache.delete(key)
  cache.set(key, {
    resolution,
    expiresAt: Date.now() + (resolution ? OK_TTL_MS : FAIL_TTL_MS),
  })
  if (cache.size > MAX_ENTRIES) {
    for (const stale of cache.keys()) {
      cache.delete(stale)
      if (cache.size <= MAX_ENTRIES) break
    }
  }
}

async function lookup(parsed: Nip05Identifier, options: Nip05Options): Promise<Nip05Resolution | null> {
  const fetchImpl = options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (!fetchImpl) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await fetchImpl(
      `https://${parsed.domain}/.well-known/nostr.json?name=${encodeURIComponent(parsed.name)}`,
      {
        // NIP-05 forbids redirects on this endpoint: following one would let any host.
        redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      },
    )
    if (!response.ok) return null
    const body = await response.text()
    if (body.length > MAX_DOC_CHARS) return null

    const document: unknown = JSON.parse(body)
    const record = readDocument(document, parsed.name)
    if (!record) return null
    return { ...parsed, pubkey: record.pubkey, relays: record.relays, checkedAt: Date.now() }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function readDocument(document: unknown, name: string): { pubkey: Hex; relays: RelayUrl[] } | null {
  if (typeof document !== 'object' || document === null) return null
  const names = (document as { names?: unknown }).names
  if (typeof names !== 'object' || names === null) return null

  const claimed = lookupKey(names as Record<string, unknown>, name)
  if (typeof claimed !== 'string') return null
  // Servers do publish uppercase hex.
  const pubkey = claimed.trim().toLowerCase()
  if (!HEX64.test(pubkey)) return null

  const relays: RelayUrl[] = []
  const relayMap = (document as { relays?: unknown }).relays
  if (typeof relayMap === 'object' && relayMap !== null) {
    const hints = lookupKey(relayMap as Record<string, unknown>, pubkey)
    if (Array.isArray(hints)) {
      for (const url of hints) if (typeof url === 'string' && url.length > 0) relays.push(url)
    }
  }
  return { pubkey, relays }
}

/** Exact match first, then case-insensitive. */
function lookupKey(table: Record<string, unknown>, key: string): unknown {
  const direct = table[key]
  if (direct !== undefined) return direct
  const wanted = key.toLowerCase()
  for (const [candidate, value] of Object.entries(table)) {
    if (candidate.toLowerCase() === wanted) return value
  }
  return undefined
}
