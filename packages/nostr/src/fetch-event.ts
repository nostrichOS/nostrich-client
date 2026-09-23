/** Fetching one specific event, including ones our relays have never held. */

import { referencesFromContent } from './content'
import { getTags } from './events'
// The same pointer NIP-19 decodes to: { id, relays?, author?, kind.
import type { EventPointer } from './keys'
import { isReply } from './thread'
import { isPrivateUrl, parseRelayList, readRelaysForAuthor, RELAY_LIST_KIND, tryNormalizeRelayUrl } from './relays'
import type { Hex, NostrEvent, RelayUrl } from './types'

/** Anything that can find events. */
export interface EventQuerier {
  query(filters: unknown[], relays?: RelayUrl[], timeoutMs?: number): Promise<NostrEvent[]>
}

export interface FetchEventOptions {
  /** Relays that aggregate kind-10002 for the whole network. */
  indexers?: readonly RelayUrl[]
  /** Write relays to try per author. */
  maxAuthorRelays?: number
  timeoutMs?: number
  /** Resolve an author's write relays, injected so the caller can cache per AUTHOR. */
  writeRelaysFor?: (author: Hex) => Promise<RelayUrl[]>
}

const DEFAULT_TIMEOUT_MS = 6_000
const DEFAULT_MAX_AUTHOR_RELAYS = 4

/** Usable relay URLs, deduped, with anything pointing inside the reader's own network. */
function usable(urls: readonly string[] | undefined, exclude: ReadonlySet<string>): RelayUrl[] {
  const out: RelayUrl[] = []
  for (const raw of urls ?? []) {
    const url = tryNormalizeRelayUrl(raw)
    if (url === undefined || isPrivateUrl(url) || exclude.has(url) || out.includes(url)) continue
    out.push(url)
  }
  return out
}

/** The author's write relays, per their own kind-10002. Asked of the indexers. */
export async function fetchAuthorWriteRelays(
  querier: EventQuerier,
  author: Hex,
  options: FetchEventOptions = {},
): Promise<RelayUrl[]> {
  const filters = [{ kinds: [RELAY_LIST_KIND], authors: [author], limit: 4 }]
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const indexers = options.indexers === undefined ? [] : [...options.indexers]

  const answers = await Promise.all([
    querier.query(filters, undefined, timeoutMs).catch(() => []),
    indexers.length === 0
      ? Promise.resolve<NostrEvent[]>([])
      : querier.query(filters, indexers, timeoutMs).catch(() => []),
  ])
  const lists = answers.flat()

  let newest: NostrEvent | undefined
  for (const event of lists) {
    if (event.kind !== RELAY_LIST_KIND || event.pubkey !== author) continue
    if (newest === undefined || event.created_at > newest.created_at) newest = event
  }
  if (newest === undefined) return []

  // `fallback: []` matters: without it a list with no write entries returns.
  return usable(
    readRelaysForAuthor(parseRelayList(newest), {
      max: options.maxAuthorRelays ?? DEFAULT_MAX_AUTHOR_RELAYS,
      fallback: [],
    }),
    new Set(),
  )
}

/** One event, chased as far as the protocol allows. */
export async function fetchEventByPointer(
  querier: EventQuerier,
  pointer: EventPointer,
  options: FetchEventOptions = {},
): Promise<NostrEvent | undefined> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const filters = [{ ids: [pointer.id] }]
  const hints = usable(pointer.relays, new Set())
  const tried = new Set<string>(hints)

  /** Relays are not obliged to honour a filter. */
  const matching = (events: readonly NostrEvent[]): NostrEvent | undefined =>
    events.find(event => event.id === pointer.id)

  // Rung 1: the hints, when the pointer carries any.
  if (hints.length > 0) {
    const hinted = matching(await querier.query(filters, hints, timeoutMs).catch(() => []))
    if (hinted !== undefined) return hinted
  }

  /** Rung 2: the relays we already read. */
  const ours = matching(await querier.query(filters, undefined, timeoutMs).catch(() => []))
  if (ours !== undefined) return ours

  if (pointer.author === undefined) return undefined

  /** Rung 3: the author's own write relays. */
  const resolve =
    options.writeRelaysFor ??
    ((author: Hex) => fetchAuthorWriteRelays(querier, author, { ...options, timeoutMs }))
  const writes = usable(await resolve(pointer.author).catch(() => []), tried)
  if (writes.length === 0) return undefined

  return matching(await querier.query(filters, writes, timeoutMs).catch(() => []))
}

/** Who wrote the event this pointer names, if anything in the note says. */
export function quotedAuthorFromTags(event: NostrEvent, id: Hex): Hex | undefined {
  // NIP-18 `q`: ["q", <id>, <relay>, <pubkey>].
  for (const tag of getTags(event, 'q')) {
    if (tag[1] === id && isHex(tag[3])) return tag[3]
  }
  // NIP-10 `e`: ["e", <id>, <relay>, <marker>, <pubkey>].
  for (const tag of getTags(event, 'e')) {
    if (tag[1] === id && isHex(tag[4])) return tag[4]
  }

  /** Past this point we are inferring from `p` tags, and a `p` tag means "notify. */
  if (isReply(event)) return undefined

  /** A pubkey the body @-mentions is explained by that mention. */
  const inline = new Set<string>(referencesFromContent(event.content, event.tags).pubkeys)
  const candidates = getTags(event, 'p').filter(tag => isHex(tag[1]) && !inline.has(tag[1]))

  // another client's shape, and the one that fixes the reported note: a single p tag.
  const marked = candidates.filter(tag => tag[3] === 'mention')
  if (marked.length === 1) return marked[0]?.[1] as Hex

  // Otherwise a lone unexplained p tag.
  if (candidates.length === 1) return candidates[0]?.[1] as Hex
  return undefined
}

function isHex(value: string | undefined): value is Hex {
  return value !== undefined && /^[0-9a-f]{64}$/.test(value)
}
