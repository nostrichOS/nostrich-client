import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { isPrivateHostname } from '@nostrich/nostr'

/** The SSRF guard, shared by every route that fetches a URL somebody else chose. */

/** Why a URL was refused, because the three reasons deserve different answers. */
export type UrlVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: 'invalid' | 'private' | 'unresolved' }

/** DNS failures that mean "ask again", as opposed to "there is no such name". */
const TEMPORARY = new Set(['EAI_AGAIN', 'ETIMEOUT', 'ETIMEDOUT', 'ESERVFAIL', 'ECONNREFUSED'])

/** Every address a hostname resolves to must be public. */
export async function resolveVerdict(hostname: string): Promise<'public' | 'private' | 'unresolved'> {
  if (isPrivateHostname(hostname)) return 'private'
  // A literal IP has nothing to resolve.
  if (isIP(hostname) !== 0) return 'public'

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const addresses = await lookup(hostname, { all: true })
      if (addresses.length === 0) return 'unresolved'
      return addresses.every(address => !isPrivateHostname(address.address)) ? 'public' : 'private'
    } catch (error) {
      const code = (error as { code?: string }).code ?? ''
      // NXDOMAIN and friends are answers: there is no such name, and asking again will.
      if (!TEMPORARY.has(code)) return 'unresolved'
      // A short pause, because the failures seen here are resolver contention rather.
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 120))
    }
  }
  return 'unresolved'
}

/** Kept for callers that only care whether it may be fetched. */
export async function resolvesPublicly(hostname: string): Promise<boolean> {
  return (await resolveVerdict(hostname)) === 'public'
}

export async function checkUrl(raw: string): Promise<UrlVerdict> {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'invalid' }
  }
  const verdict = await resolveVerdict(parsed.hostname)
  if (verdict === 'public') return { ok: true, url: parsed }
  return { ok: false, reason: verdict === 'private' ? 'private' : 'unresolved' }
}

export async function safeUrl(raw: string): Promise<URL | null> {
  const verdict = await checkUrl(raw)
  return verdict.ok ? verdict.url : null
}
