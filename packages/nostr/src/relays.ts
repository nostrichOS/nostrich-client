import type { EventTemplate, Hex, NostrEvent, RelayList, RelayPolicy, RelayUrl } from './types'

/** One line of a NIP-65 relay list. */
export type RelayEntry = { url: RelayUrl; policy: RelayPolicy }

/** NIP-65 relay list metadata. */
export const RELAY_LIST_KIND = 10002

/** Starting relays for a user who has not published a NIP-65 list yet. */
export const DEFAULT_RELAYS: readonly RelayUrl[] = Object.freeze([
  'wss://nos.lol',
  // Added 2026-08-16, chosen by measurement rather than reputation: each was queried.

  // nostr.mom +166 new.

  // Scored well and still not here, all by operator decision: nostrelites.org.
  'wss://nostr.mom',
])

/** The default set with its policies. */
/** Relays that will not accept a write from someone who has not paid them. */
const READ_ONLY_RELAYS: readonly string[] = Object.freeze([])

export const DEFAULT_RELAY_ENTRIES: readonly RelayEntry[] = Object.freeze(
  DEFAULT_RELAYS.map(url =>
    Object.freeze({
      url,
      policy: { read: true, write: !READ_ONLY_RELAYS.includes(url) },
    }),
  ),
) as readonly RelayEntry[]

/** Where a `nostrconnect://` invite tells a remote signer to meet us. */
const SIGNER_RENDEZVOUS_RELAY = 'wss://relay.powr.build' as RelayUrl

export const DEFAULT_SIGNER_RELAYS: readonly RelayUrl[] = Object.freeze([
  ...DEFAULT_RELAY_ENTRIES.filter(entry => entry.policy.write).map(entry => entry.url),
  SIGNER_RENDEZVOUS_RELAY,
])

/** Relays this app declares read-only. */
const READ_ONLY: ReadonlySet<string> = new Set(
  DEFAULT_RELAY_ENTRIES.filter(entry => !entry.policy.write).map(entry => entry.url),
)

/** REPAIR A PAIRING THAT WAS STORED WITH A RELAY NOBODY CAN ANSWER. */
export function signerRelays(stored: readonly string[]): RelayUrl[] {
  const out: RelayUrl[] = []
  for (const url of [...stored, ...DEFAULT_SIGNER_RELAYS]) {
    const normalized = tryNormalizeRelayUrl(url)
    if (normalized === undefined || READ_ONLY.has(normalized) || out.includes(normalized)) continue
    out.push(normalized)
  }
  return out
}

/** Where a kind-10050 points when this app has to create one. */
export const DEFAULT_DM_RELAYS: readonly RelayUrl[] = Object.freeze([
  'wss://nos.lol',
  'wss://nostr.mom',
])

/** Relays that can answer a NIP-50 `search` filter. */
/** Extra relays consulted for ZAP RECEIPTS ONLY (kind 9735), never for the feed. */
export const ZAP_RELAYS: readonly RelayUrl[] = Object.freeze([
  /* `nostr.land` was here and is not any more, by the same measurement that added. */
  /* `relay.nostr.band` was here and is REMOVED. */
  'wss://nostr-pub.wellorder.net',
  /* Added 2026-09-04, by the same method and for a specific missing receipt. */
  'wss://nostr.oxtr.dev',
  'wss://relay.mostr.pub',
  /* ── AND THIS IS WHERE ADDING RELAYS STOPS WORKING ───────────────────────────────────. */
] as RelayUrl[])

/** Relays that actually implement NIP-50, which is a much shorter list than the ones. */
export const SEARCH_RELAYS: readonly RelayUrl[] = Object.freeze([
  'wss://search.nos.today',
])

/** Filters one REQ may carry. */
export const MAX_FILTERS_PER_REQ = 10

/** Relays that aggregate kind-0 and kind-10002 for the whole network. */
export const DEFAULT_INDEXER_RELAYS: readonly RelayUrl[] = Object.freeze([
  'wss://user.kindpag.es',
])

/** Fresh objects every call. */

export function defaultRelayEntries(): RelayEntry[] {
  return DEFAULT_RELAYS.map(url => ({
    url,
    policy: { read: true, write: !READ_ONLY_RELAYS.includes(url) },
  }))
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/** Hosts we are willing to talk to over plaintext ws://. */
const LOCAL_HOST_RE = /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\]|.+\.local)$/

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOST_RE.test(hostname)
}

/** Canonical form of a relay URL. */
export function normalizeRelayUrl(input: string): RelayUrl {
  const raw = input.trim()
  if (raw === '') throw new TypeError('relay url is empty')

  const hadScheme = SCHEME_RE.test(raw)
  const withScheme = hadScheme ? raw : `wss://${raw}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new TypeError(`invalid relay url: ${input}`)
  }
  if (url.hostname === '') throw new TypeError(`relay url has no host: ${input}`)
  /* A PUBLIC RELAY HAS A DOT IN ITS NAME. */
  if (!url.hostname.includes('.') && !isLocalHost(url.hostname)) {
    throw new TypeError(`relay url has no domain: ${input}`)
  }

  let protocol: 'ws:' | 'wss:'
  switch (url.protocol.toLowerCase()) {
    case 'ws:':
    case 'http:':
      protocol = 'ws:'
      break
    case 'wss:':
    case 'https:':
      protocol = 'wss:'
      break
    default:
      throw new TypeError(`unsupported relay scheme: ${url.protocol}`)
  }

  if (isLocalHost(url.hostname)) {
    // A bare "localhost:7777" is a dev relay, which almost never has TLS.
    if (!hadScheme) protocol = 'ws:'
  } else {
    // Forcing wss:// off-localhost is not only about transport security: relays.
    protocol = 'wss:'
  }

  let port = url.port
  if ((protocol === 'wss:' && port === '443') || (protocol === 'ws:' && port === '80')) port = ''

  let path = url.pathname.replace(/\/{2,}/g, '/')
  while (path.endsWith('/')) path = path.slice(0, -1)

  // Sorted so ?a=1&b=2 and ?b=2&a=1 collapse to one relay.
  url.searchParams.sort()
  const search = url.search === '?' ? '' : url.search

  const auth = url.username === '' ? '' : `${url.username}${url.password === '' ? '' : `:${url.password}`}@`
  const host = port === '' ? url.hostname : `${url.hostname}:${port}`

  // Assembled by hand rather than via URL.toString(): ws/wss are WHATWG "special".
  return `${protocol}//${auth}${host}${path}${search}`
}

/** Non-throwing `normalizeRelayUrl`, for parsing whatever strangers put in their tags. */
export function tryNormalizeRelayUrl(input: string): RelayUrl | undefined {
  try {
    return normalizeRelayUrl(input)
  } catch {
    return undefined
  }
}

export function isRelayUrl(input: string): boolean {
  return tryNormalizeRelayUrl(input) !== undefined
}

/** Normalise, drop the unusable, and dedupe while keeping the caller's ordering. */
export function normalizeRelayUrls(inputs: Iterable<string>): RelayUrl[] {
  const out: RelayUrl[] = []
  const seen = new Set<RelayUrl>()
  for (const input of inputs) {
    const url = tryNormalizeRelayUrl(input)
    if (url === undefined || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

export function relayUrlsEqual(a: string, b: string): boolean {
  const left = tryNormalizeRelayUrl(a)
  return left !== undefined && left === tryNormalizeRelayUrl(b)
}

// --------------------------------------------------------------------------- NIP-65.

/** Read the `r` tags of a kind-10002. Exported separately from `parseRelayList`. */
export function parseRelayTags(tags: readonly (readonly string[])[]): RelayEntry[] {
  const byUrl = new Map<RelayUrl, RelayPolicy>()
  for (const tag of tags) {
    if (tag[0] !== 'r') continue
    const rawUrl = tag[1]
    if (rawUrl === undefined) continue
    const url = tryNormalizeRelayUrl(rawUrl)
    if (url === undefined) continue

    const marker = tag[2]?.trim().toLowerCase()
    // A bare `r` tag means read AND write.
    const policy: RelayPolicy =
      marker === 'read'
        ? { read: true, write: false }
        : marker === 'write'
          ? { read: false, write: true }
          : { read: true, write: true }

    const existing = byUrl.get(url)
    // One relay tagged twice with opposite markers is a relay with both permissions.
    byUrl.set(
      url,
      existing === undefined
        ? policy
        : { read: existing.read || policy.read, write: existing.write || policy.write },
    )
  }
  return [...byUrl].map(([url, policy]) => ({ url, policy }))
}

/** Parse a kind-10002 into a `RelayList`. */
export function parseRelayList(event: NostrEvent): RelayList {
  if (event.kind !== RELAY_LIST_KIND) {
    throw new TypeError(`expected kind ${RELAY_LIST_KIND} relay list, got kind ${event.kind}`)
  }
  return { entries: parseRelayTags(event.tags), updatedAt: event.created_at }
}

/** Inverse of `parseRelayTags`. */
export function buildRelayListTags(entries: readonly RelayEntry[]): string[][] {
  const tags: string[][] = []
  for (const entry of entries) {
    const url = tryNormalizeRelayUrl(entry.url)
    if (url === undefined) continue
    // An entry with neither permission is a relay the user turned off, not a relay.
    if (!entry.policy.read && !entry.policy.write) continue
    if (entry.policy.read && entry.policy.write) tags.push(['r', url])
    else if (entry.policy.read) tags.push(['r', url, 'read'])
    else tags.push(['r', url, 'write'])
  }
  return tags
}

export function buildRelayListEvent(
  entries: readonly RelayEntry[],
  createdAt: number = Math.floor(Date.now() / 1000),
): EventTemplate {
  // NIP-65 reserves `content` for a future use and says clients must leave it empty.
  return { kind: RELAY_LIST_KIND, created_at: createdAt, tags: buildRelayListTags(entries), content: '' }
}

// --------------------------------------------------------------------------- Relay.

export interface RelayPickOptions {
  /** Cap the result. */
  max?: number
  /** Used when the list is missing or has no matching entry. */
  fallback?: readonly RelayUrl[]
}

function pick(list: RelayList | undefined, want: keyof RelayPolicy, opts?: RelayPickOptions): RelayUrl[] {
  const matched = (list?.entries ?? []).filter(entry => entry.policy[want]).map(entry => entry.url)
  const chosen = matched.length > 0 ? matched : [...(opts?.fallback ?? DEFAULT_RELAYS)]
  const max = opts?.max
  return max !== undefined && max > 0 ? chosen.slice(0, max) : chosen
}

/** Where we send our own events: our own write relays. */
export function publishRelays(list: RelayList | undefined, opts?: RelayPickOptions): RelayUrl[] {
  return pick(list, 'write', opts)
}

/** Where to fetch an author's notes from: that author's WRITE relays. */
export function readRelaysForAuthor(list: RelayList | undefined, opts?: RelayPickOptions): RelayUrl[] {
  return pick(list, 'write', opts)
}

/** Where to deliver something addressed TO someone (a reply, a mention, a DM). */
export function inboxRelaysForAuthor(list: RelayList | undefined, opts?: RelayPickOptions): RelayUrl[] {
  return pick(list, 'read', opts)
}

export interface OutboxOptions {
  /** Most write relays we will consider per author. */
  maxPerAuthor?: number
  /** How many chosen relays should carry each author, so one dead relay does not erase. */
  redundancy?: number
  /** Hard ceiling on sockets. */
  maxTotal?: number
}

export interface OutboxSelection {
  /** The relays to connect to, in the order greedy coverage picked them. */
  relays: RelayUrl[]
  /** Per relay, the authors it is worth asking that relay. */
  byRelay: Map<RelayUrl, Hex[]>
  /** Authors with no usable relay list, or squeezed out by `maxTotal`. */
  uncovered: Hex[]
}

/** Outbox model: the smallest relay set that reaches every author. */
export function selectOutboxRelays(
  authors: Iterable<Hex>,
  lists: ReadonlyMap<Hex, RelayList>,
  opts?: OutboxOptions,
): OutboxSelection {
  const maxPerAuthor = Math.max(1, opts?.maxPerAuthor ?? 4)
  const redundancy = Math.max(1, opts?.redundancy ?? 2)
  const maxTotal = Math.max(1, opts?.maxTotal ?? 16)

  const servedBy = new Map<RelayUrl, Set<Hex>>()
  const authorRelayCount = new Map<Hex, number>()
  const uncovered: Hex[] = []

  for (const author of new Set(authors)) {
    const urls = readRelaysForAuthor(lists.get(author), { max: maxPerAuthor, fallback: [] })
    if (urls.length === 0) {
      uncovered.push(author)
      continue
    }
    authorRelayCount.set(author, urls.length)
    for (const url of urls) {
      const set = servedBy.get(url)
      if (set === undefined) servedBy.set(url, new Set([author]))
      else set.add(author)
    }
  }

  const ordered = [...servedBy.keys()].sort()
  const coverage = new Map<Hex, number>()
  const relays: RelayUrl[] = []
  const byRelay = new Map<RelayUrl, Hex[]>()
  const taken = new Set<RelayUrl>()

  while (relays.length < maxTotal) {
    let best: RelayUrl | undefined
    let bestGain = 0
    for (const url of ordered) {
      if (taken.has(url)) continue
      let gain = 0
      for (const author of servedBy.get(url) ?? []) {
        // An author listing only one relay can never reach `redundancy`.
        const need = Math.min(redundancy, authorRelayCount.get(author) ?? 0)
        if ((coverage.get(author) ?? 0) < need) gain += 1
      }
      if (gain > bestGain) {
        bestGain = gain
        best = url
      }
    }
    if (best === undefined) break

    taken.add(best)
    relays.push(best)
    const served = [...(servedBy.get(best) ?? [])]
    // Every author this relay carries goes into its filter, covered or not: widening.
    byRelay.set(best, served)
    for (const author of served) coverage.set(author, (coverage.get(author) ?? 0) + 1)
  }

  for (const author of authorRelayCount.keys()) {
    if ((coverage.get(author) ?? 0) === 0) uncovered.push(author)
  }

  return { relays, byRelay, uncovered }
}

/** Whether a URL points at the reader's own machine or local network. */
const PRIVATE_HOST_RE = new RegExp(
  [
    '^localhost$',
    '\\.localhost$',
    '\\.local$',
    // Loopback, link-local and the three RFC 1918 ranges.
    '^127(?:\\.\\d{1,3}){3}$',
    '^0\\.0\\.0\\.0$',
    '^10(?:\\.\\d{1,3}){3}$',
    '^192\\.168(?:\\.\\d{1,3}){2}$',
    '^172\\.(?:1[6-9]|2\\d|3[01])(?:\\.\\d{1,3}){2}$',
    '^169\\.254(?:\\.\\d{1,3}){2}$',
    // IPv6 loopback and unique-local, with or without brackets.
    '^\\[?::1?\\]?$',
    '^\\[?f[cd][0-9a-f]{2}:',
    '^\\[?fe80:',
  ].join('|'),
  'i',
)

export function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_HOST_RE.test(hostname.trim())
}

/** True when a URL should never be fetched on the reader's behalf. */
export function isPrivateUrl(value: string): boolean {
  try {
    return isPrivateHostname(new URL(value).hostname)
  } catch {
    return true
  }
}
