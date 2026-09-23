/** The relay cookie's payload format, on its own so it can be tested without a browser. */

/** Where the stored list came. */
export type StoredSource = 'imported' | 'edited'

/** What a relay entry is FOR. `read + write` is the default and is stored as absent. */
export type RelayPolicyChoice = 'both' | 'read' | 'write'

export interface StoredRelays {
  urls: string[]
  src: StoredSource
  /** Per-relay policy the reader chose HERE, keyed by url. */
  policies?: Record<string, RelayPolicyChoice>
}

/** Parse a cookie value. */
export function parseRelayCookie(raw: string): StoredRelays | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (Array.isArray(parsed)) {
    const urls = parsed.filter((u): u is string => typeof u === 'string')
    return urls.length > 0 ? { urls, src: 'edited' } : null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as { urls?: unknown; src?: unknown; policies?: unknown }
  if (!Array.isArray(record.urls)) return null
  const urls = record.urls.filter((u): u is string => typeof u === 'string')
  if (urls.length === 0) return null
  // Anything that is not exactly 'imported' is treated as edited, for the reason above.
  const src: StoredSource = record.src === 'imported' ? 'imported' : 'edited'
  const policies = readPolicies(record.policies, urls)
  return policies === undefined ? { urls, src } : { urls, src, policies }
}

export function serializeRelayCookie(
  urls: readonly string[],
  src: StoredSource,
  policies?: Readonly<Record<string, RelayPolicyChoice>>,
): string {
  // Every choice travels, `both` included.
  const kept = Object.entries(policies ?? {}).filter(([url]) => urls.includes(url))
  return JSON.stringify(kept.length === 0 ? { urls, src } : { urls, src, policies: Object.fromEntries(kept) })
}

/** Policies for urls that are actually in the list, and nothing else. */
function readPolicies(
  value: unknown,
  urls: readonly string[],
): Record<string, RelayPolicyChoice> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Record<string, RelayPolicyChoice> = {}
  for (const [url, choice] of Object.entries(value as Record<string, unknown>)) {
    if (!urls.includes(url)) continue
    if (choice === 'read' || choice === 'write' || choice === 'both') out[url] = choice
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** Order-insensitive comparison. */
export function sameRelayList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join()
}
