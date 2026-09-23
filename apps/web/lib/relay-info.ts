'use client'

import { tryNormalizeRelayUrl, type RelayUrl } from '@nostrich/nostr'

/** NIP-11: what a relay says about itself over HTTP. */

export interface RelayInfo {
  name?: string
  paymentRequired: boolean
  authRequired: boolean
  restrictedWrites: boolean
}

/** Whether this document describes a relay that will turn away a stranger's gift wrap. */
export function refusesStrangers(info: RelayInfo): boolean {
  return info.paymentRequired || info.authRequired || info.restrictedWrites
}

/** Long enough for a relay's web server, short enough that six of them do not stall. */
const TIMEOUT_MS = 6_000

/** Cached for the tab's lifetime. */
const cache = new Map<RelayUrl, RelayInfo | null>()

function bool(value: unknown): boolean {
  return value === true
}

function httpUrl(relay: RelayUrl): string | undefined {
  const url = tryNormalizeRelayUrl(relay)
  if (url === undefined) return undefined
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
}

/** Fetch a relay's NIP-11 document. */
export async function fetchRelayInfo(relay: RelayUrl): Promise<RelayInfo | undefined> {
  const held = cache.get(relay)
  if (held !== undefined) return held ?? undefined

  const url = httpUrl(relay)
  if (url === undefined) return undefined

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/nostr+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      cache.set(relay, null)
      return undefined
    }
    const body: unknown = await res.json()
    if (typeof body !== 'object' || body === null) {
      cache.set(relay, null)
      return undefined
    }
    const doc = body as { name?: unknown; limitation?: Record<string, unknown> }
    const limits = typeof doc.limitation === 'object' && doc.limitation !== null ? doc.limitation : {}
    const info: RelayInfo = {
      ...(typeof doc.name === 'string' && doc.name !== '' ? { name: doc.name } : {}),
      paymentRequired: bool(limits['payment_required']),
      authRequired: bool(limits['auth_required']),
      restrictedWrites: bool(limits['restricted_writes']),
    }
    cache.set(relay, info)
    return info
  } catch {
    // Unreachable, CORS-blocked, not JSON, or timed out.
    cache.set(relay, null)
    return undefined
  }
}

/** Forgets every cached document. */
export function forgetRelayInfo(): void {
  cache.clear()
}
