import { getPow } from 'nostr-tools/nip13'
/* Re-exported for callers that hold an event from an UNTRUSTED container. */
export { verifyEvent } from 'nostr-tools/pure'
import {
  Contacts,
  EventDeletion,
  GenericRepost,
  LongFormArticle,
  Metadata,
  Reaction,
  RelayList as RelayListKind,
  Report,
  Repost,
  ShortTextNote,
} from 'nostr-tools/kinds'

// Relay URLs are canonicalised in exactly one place.
import { tryNormalizeRelayUrl } from './relays'
import type { EventTemplate, Hex, NostrEvent, RelayUrl } from './types'

/** Kind numbers this module builds and parses, so callers never hardcode an integer. */
export const KINDS = {
  metadata: Metadata,
  shortNote: ShortTextNote,
  contacts: Contacts,
  deletion: EventDeletion,
  repost: Repost,
  reaction: Reaction,
  genericRepost: GenericRepost,
  relayList: RelayListKind,
  report: Report,
  longForm: LongFormArticle,
  /** NIP-22 comment. */
  comment: 1111,
} as const

export type KnownKind = (typeof KINDS)[keyof typeof KINDS]

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

// --------------------------------------------------------------------------- Tags.

/** Signed events, unsigned templates and raw relay payloads all satisfy. */
export interface Tagged {
  readonly tags: readonly (readonly string[])[]
}

/** Every matching tag, copied so callers cannot mutate the event they were handed. */
export function getTags(source: Tagged, name: string): string[][] {
  const out: string[][] = []
  for (const tag of source.tags) {
    if (tag[0] === name) out.push([...tag])
  }
  return out
}

export function getTag(source: Tagged, name: string): string[] | undefined {
  for (const tag of source.tags) {
    if (tag[0] === name) return [...tag]
  }
  return undefined
}

/** Value of the first *usable* tag with this name. */
export function getTagValue(source: Tagged, name: string): string | undefined {
  for (const tag of source.tags) {
    if (tag[0] !== name) continue
    const value = tag[1]
    if (value !== undefined) return value
  }
  return undefined
}

export function getTagValues(source: Tagged, name: string): string[] {
  const out: string[] = []
  for (const tag of source.tags) {
    if (tag[0] !== name) continue
    const value = tag[1]
    if (value !== undefined) out.push(value)
  }
  return out
}

/** Element `index` of the first tag named `name`. */
export function getTagElement(source: Tagged, name: string, index: number): string | undefined {
  for (const tag of source.tags) {
    if (tag[0] === name) return tag[index]
  }
  return undefined
}

const HEX_64 = /^[0-9a-f]{64}$/

export function isHex64(value: string | undefined): value is Hex {
  return value !== undefined && HEX_64.test(value)
}

/** Other clients write mixed-case hex into tags. */
export function normalizeHex(value: string | undefined): Hex | undefined {
  if (value === undefined) return undefined
  const lower = value.trim().toLowerCase()
  return HEX_64.test(lower) ? lower : undefined
}

/** Tag values that survive hex validation, deduplicated, order preserved. */
export function getHexTagValues(source: Tagged, name: string): Hex[] {
  const seen = new Set<Hex>()
  const out: Hex[] = []
  for (const value of getTagValues(source, name)) {
    const hex = normalizeHex(value)
    if (hex === undefined || seen.has(hex)) continue
    seen.add(hex)
    out.push(hex)
  }
  return out
}

export function getReferencedIds(source: Tagged): Hex[] {
  return getHexTagValues(source, 'e')
}

export function getReferencedPubkeys(source: Tagged): Hex[] {
  return getHexTagValues(source, 'p')
}

/** The `d` tag. Addressable events without one are addressed by the empty identifier. */
export function getIdentifier(source: Tagged): string {
  return getTagValue(source, 'd') ?? ''
}

// --------------------------------------------------------------------------- Kind.

export function isReplaceable(kind: number): boolean {
  return kind === Metadata || kind === Contacts || (kind >= 10000 && kind < 20000)
}

export function isEphemeral(kind: number): boolean {
  return kind >= 20000 && kind < 30000
}

export function isAddressable(kind: number): boolean {
  return kind >= 30000 && kind < 40000
}

/** `kind:pubkey:identifier`, the value of an `a` tag. */
export function eventAddress(event: Pick<NostrEvent, 'kind' | 'pubkey'> & Tagged): string {
  return `${event.kind}:${event.pubkey.toLowerCase()}:${getIdentifier(event)}`
}

export interface ParsedAddress {
  kind: number
  pubkey: Hex
  identifier: string
}

/** Identifiers may contain `:`, so only the first two separators are structural. */
export function parseAddress(value: string): ParsedAddress | undefined {
  const firstColon = value.indexOf(':')
  if (firstColon < 1) return undefined
  const secondColon = value.indexOf(':', firstColon + 1)
  if (secondColon < 0) return undefined
  const kind = Number.parseInt(value.slice(0, firstColon), 10)
  const pubkey = normalizeHex(value.slice(firstColon + 1, secondColon))
  if (!Number.isInteger(kind) || kind < 0 || pubkey === undefined) return undefined
  return { kind, pubkey, identifier: value.slice(secondColon + 1) }
}

// --------------------------------------------------------------------------- Builders.

export interface BuildOptions {
  createdAt?: number
  /** Appended verbatim after the tags the builder generates. */
  tags?: string[][]
}

/* NO CLIENT TAG HERE. */
function template(kind: number, content: string, tags: string[][], options: BuildOptions): EventTemplate {
  return {
    kind,
    created_at: options.createdAt ?? nowSeconds(),
    tags: options.tags === undefined ? tags : [...tags, ...options.tags],
    content,
  }
}

// --- kind 0 ---------------------------------------------------------------.

/** The NIP-01 wire shape of kind-0 content. */
export interface MetadataContent {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  banner?: string
  nip05?: string
  lud16?: string
  lud06?: string
  website?: string
  [field: string]: unknown
}

/** Unknown keys pass through untouched. */
export function buildMetadata(content: MetadataContent, options: BuildOptions = {}): EventTemplate {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(content)) {
    if (value === undefined || value === null || value === '') continue
    body[key] = value
  }
  return template(Metadata, JSON.stringify(body), [], options)
}

// --- kind 1 ---------------------------------------------------------------.

export function buildShortNote(content: string, options: BuildOptions = {}): EventTemplate {
  return template(ShortTextNote, content, [], options)
}

// --- kind 3 ---------------------------------------------------------------.

export interface Contact {
  pubkey: Hex
  relay?: RelayUrl
  petname?: string
}

export function parseContacts(source: Tagged): Contact[] {
  const seen = new Set<Hex>()
  const out: Contact[] = []
  for (const tag of source.tags) {
    if (tag[0] !== 'p') continue
    const pubkey = normalizeHex(tag[1])
    if (pubkey === undefined || seen.has(pubkey)) continue
    seen.add(pubkey)
    const relay = tag[2] === undefined || tag[2] === '' ? undefined : tryNormalizeRelayUrl(tag[2])
    const petname = tag[3] === undefined || tag[3] === '' ? undefined : tag[3]
    const contact: Contact = { pubkey }
    if (relay !== undefined) contact.relay = relay
    if (petname !== undefined) contact.petname = petname
    out.push(contact)
  }
  return out
}

export interface ContactsOptions extends BuildOptions {
  /** Kind-3 content is a legacy relay-config blob that some clients still read. */
  content?: string
}

export function buildContacts(contacts: readonly Contact[], options: ContactsOptions = {}): EventTemplate {
  const tags: string[][] = []
  const seen = new Set<Hex>()
  for (const contact of contacts) {
    const pubkey = normalizeHex(contact.pubkey)
    if (pubkey === undefined || seen.has(pubkey)) continue
    seen.add(pubkey)
    const tag = ['p', pubkey]
    // Petname lives at index 3, so an absent relay still has to occupy index 2.
    if (contact.petname !== undefined && contact.petname !== '') {
      tag.push(contact.relay ?? '', contact.petname)
    } else if (contact.relay !== undefined && contact.relay !== '') {
      tag.push(contact.relay)
    }
    tags.push(tag)
  }
  return template(Contacts, options.content ?? '', tags, options)
}

// --- kind 5 ---------------------------------------------------------------.

export type DeletionTarget = Pick<NostrEvent, 'id' | 'kind' | 'pubkey'> & Partial<Tagged>

export interface DeletionOptions extends BuildOptions {
  reason?: string
}

/** Relays only honour a deletion signed by the same pubkey that wrote the target. */
export function buildDeletion(
  targets: readonly DeletionTarget[],
  authorPubkey: Hex,
  options: DeletionOptions = {},
): EventTemplate {
  const author = normalizeHex(authorPubkey)
  const tags: string[][] = []
  const kinds = new Set<number>()
  const addresses = new Set<string>()
  const ids = new Set<Hex>()

  for (const target of targets) {
    const id = normalizeHex(target.id)
    if (id === undefined || ids.has(id)) continue
    if (author !== undefined && normalizeHex(target.pubkey) !== author) continue
    ids.add(id)
    tags.push(['e', id])
    kinds.add(target.kind)
    if (isAddressable(target.kind)) {
      addresses.add(eventAddress({ kind: target.kind, pubkey: target.pubkey, tags: target.tags ?? [] }))
    }
  }
  for (const address of addresses) tags.push(['a', address])
  for (const kind of kinds) tags.push(['k', String(kind)])

  return template(EventDeletion, options.reason ?? '', tags, options)
}

export function parseDeletion(source: Tagged & { content: string }): { ids: Hex[]; addresses: string[]; reason: string } {
  return {
    ids: getHexTagValues(source, 'e'),
    addresses: getTagValues(source, 'a'),
    reason: source.content,
  }
}

// --- kinds 6 / 16 ---------------------------------------------------------.

export interface RepostOptions extends BuildOptions {
  /** Relay hint for the `e` tag, so a client that has never heard of the note can find. */
  relay?: RelayUrl
}

/** Kind 6 is defined for kind-1 notes only. */
export function buildRepost(event: NostrEvent, options: RepostOptions = {}): EventTemplate {
  const relay = tryNormalizeRelayUrl(options.relay ?? '') ?? ''
  const tags: string[][] = [['e', event.id.toLowerCase(), relay]]
  if (isAddressable(event.kind)) tags.push(['a', eventAddress(event), relay])
  tags.push(['p', event.pubkey.toLowerCase()])
  const kind = event.kind === ShortTextNote ? Repost : GenericRepost
  if (kind === GenericRepost) tags.push(['k', String(event.kind)])
  return template(kind, JSON.stringify(event), tags, options)
}

export function getRepostedId(source: Tagged): Hex | undefined {
  return getReferencedIds(source)[0]
}

/** The embedded event is attacker-controlled: anyone can repost note X while embedding. */
export function parseRepost(event: NostrEvent): NostrEvent | undefined {
  if (event.content === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(event.content)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const candidate = parsed as Record<string, unknown>
  const id = typeof candidate['id'] === 'string' ? normalizeHex(candidate['id']) : undefined
  const pubkey = typeof candidate['pubkey'] === 'string' ? normalizeHex(candidate['pubkey']) : undefined
  const sig = candidate['sig']
  const kind = candidate['kind']
  const createdAt = candidate['created_at']
  const content = candidate['content']
  const tags = candidate['tags']
  if (id === undefined || pubkey === undefined) return undefined
  if (typeof sig !== 'string' || typeof content !== 'string') return undefined
  if (typeof kind !== 'number' || typeof createdAt !== 'number') return undefined
  if (!Array.isArray(tags) || !tags.every(tag => Array.isArray(tag) && tag.every(part => typeof part === 'string'))) {
    return undefined
  }
  const taggedId = getRepostedId(event)
  if (taggedId !== undefined && taggedId !== id) return undefined
  return { id, pubkey, sig, kind, created_at: createdAt, content, tags: tags as string[][] }
}

// --- kind 7 ---------------------------------------------------------------.

export interface ReactionOptions extends BuildOptions {
  /** `+` like, `-` dislike, or a literal emoji. */
  content?: string
  /** NIP-30 custom emoji. */
  emoji?: { shortcode: string; url: string }
  relay?: RelayUrl
}

export function buildReaction(event: NostrEvent, options: ReactionOptions = {}): EventTemplate {
  const relay = tryNormalizeRelayUrl(options.relay ?? '') ?? ''
  const tags: string[][] = [
    ['e', event.id.toLowerCase(), relay],
    ['p', event.pubkey.toLowerCase()],
    ['k', String(event.kind)],
  ]
  if (isAddressable(event.kind)) tags.push(['a', eventAddress(event), relay])
  let content = options.content ?? '+'
  if (options.emoji !== undefined) {
    content = `:${options.emoji.shortcode}:`
    tags.push(['emoji', options.emoji.shortcode, options.emoji.url])
  }
  return template(Reaction, content, tags, options)
}

export interface ParsedReaction {
  targetId?: Hex
  targetPubkey?: Hex
  targetAddress?: string
  targetKind?: number
  /** Never empty: NIP-25 says empty content means. */
  content: string
  emojiUrl?: string
}

export function parseReaction(event: NostrEvent): ParsedReaction {
  // The *last* e tag is the reacted-to event.
  const ids = getReferencedIds(event)
  const pubkeys = getReferencedPubkeys(event)
  const kindTag = getTagValue(event, 'k')
  const kind = kindTag === undefined ? Number.NaN : Number.parseInt(kindTag, 10)
  const result: ParsedReaction = { content: event.content === '' ? '+' : event.content }
  const targetId = ids[ids.length - 1]
  if (targetId !== undefined) result.targetId = targetId
  const targetPubkey = pubkeys[pubkeys.length - 1]
  if (targetPubkey !== undefined) result.targetPubkey = targetPubkey
  const address = getTagValue(event, 'a')
  if (address !== undefined) result.targetAddress = address
  if (Number.isInteger(kind)) result.targetKind = kind
  const emoji = getTags(event, 'emoji').find(tag => tag[1] !== undefined && `:${tag[1]}:` === result.content)
  const emojiUrl = emoji?.[2]
  if (emojiUrl !== undefined) result.emojiUrl = emojiUrl
  return result
}

// Kind 10002 is not here: relays.ts owns NIP-65 end to end.

// --- kind 30023 -----------------------------------------------------------.

export interface LongFormInput {
  /** The `d` tag. */
  identifier: string
  /** Markdown. Not HTML: NIP-23 forbids it, and no platform here renders it safely. */
  content: string
  title?: string
  summary?: string
  image?: string
  /** Seconds. */
  publishedAt?: number
  hashtags?: readonly string[]
}

export function buildLongForm(article: LongFormInput, options: BuildOptions = {}): EventTemplate {
  const createdAt = options.createdAt ?? nowSeconds()
  const tags: string[][] = [['d', article.identifier]]
  if (article.title !== undefined && article.title !== '') tags.push(['title', article.title])
  if (article.summary !== undefined && article.summary !== '') tags.push(['summary', article.summary])
  if (article.image !== undefined && article.image !== '') tags.push(['image', article.image])
  // created_at moves on every edit, so first-publication time needs its own tag.
  tags.push(['published_at', String(article.publishedAt ?? createdAt)])
  const seen = new Set<string>()
  for (const hashtag of article.hashtags ?? []) {
    const normalized = hashtag.replace(/^#/, '').trim().toLowerCase()
    if (normalized === '' || seen.has(normalized)) continue
    seen.add(normalized)
    tags.push(['t', normalized])
  }
  return template(LongFormArticle, article.content, tags, { ...options, createdAt })
}

export interface ParsedLongForm extends LongFormInput {
  hashtags: string[]
  /** `30023:pubkey:identifier`. */
  address: string
  updatedAt: number
}

/** Nothing on Nostr predates. */
const EARLIEST_PLAUSIBLE = 1_500_000_000

/** Any real seconds timestamp is far below this until the year 5138, so a value above. */
const MILLISECOND_THRESHOLD = 1e11

/** Clock skew allowance when checking a publication date against its own event. */
const SKEW_SECONDS = 86_400

/** `published_at`, sanity-checked against the event carrying. */
function sanePublishedAt(raw: number, createdAt: number): number {
  if (!Number.isInteger(raw)) return createdAt
  const seconds = raw > MILLISECOND_THRESHOLD ? Math.floor(raw / 1000) : raw
  if (seconds < EARLIEST_PLAUSIBLE || seconds > createdAt + SKEW_SECONDS) return createdAt
  return seconds
}

export function parseLongForm(event: NostrEvent): ParsedLongForm {
  const publishedTag = getTagValue(event, 'published_at')
  const published = publishedTag === undefined ? Number.NaN : Number.parseInt(publishedTag, 10)
  const parsed: ParsedLongForm = {
    identifier: getIdentifier(event),
    content: event.content,
    hashtags: getTagValues(event, 't').map(tag => tag.toLowerCase()),
    address: eventAddress(event),
    updatedAt: event.created_at,
    publishedAt: sanePublishedAt(published, event.created_at),
  }
  const title = getTagValue(event, 'title')
  if (title !== undefined) parsed.title = title
  const summary = getTagValue(event, 'summary')
  if (summary !== undefined) parsed.summary = summary
  const image = getTagValue(event, 'image')
  if (image !== undefined) parsed.image = image
  return parsed
}

// --- kind 1984: reports (NIP-56) -------------------------------------------.

/** The report types NIP-56 defines. */
export type ReportType = 'nudity' | 'malware' | 'profanity' | 'illegal' | 'spam' | 'impersonation' | 'other'

export interface ReportInput {
  /** The account being reported. Always present, even when reporting a specific note. */
  pubkey: Hex
  /** The offending event, when the report is about one note rather than the account. */
  eventId?: Hex
  reportType: ReportType
  /** Optional free text. */
  reason?: string
}

/** Build a NIP-56 report. */
export function buildReport(input: ReportInput, options: BuildOptions = {}): EventTemplate {
  const hex = (value: string, label: string): string => {
    if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`report: ${label} must be 64-char hex`)
    return value
  }
  const tags: string[][] =
    input.eventId === undefined
      ? [['p', hex(input.pubkey, 'pubkey'), input.reportType]]
      : [
          ['e', hex(input.eventId, 'event id'), input.reportType],
          // The author is tagged too, without a type: NIP-56 puts the type on the e-tag.
          ['p', hex(input.pubkey, 'pubkey')],
        ]
  return template(Report, input.reason ?? '', tags, options)
}

/** NIP-13 proof-of-work: leading zero bits on an event id. */
export function powBits(id: string): number {
  try {
    return getPow(id)
  } catch {
    // A malformed id cannot carry work.
    return 0
  }
}
