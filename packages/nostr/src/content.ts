/** Note content to renderable segments. */

import { naddrEncode, decode, neventEncode, noteEncode, nprofileEncode, npubEncode } from 'nostr-tools/nip19'

import { normalizeHex, parseAddress } from './events'
import { repairMediaUrl } from './moved-hosts'
import { tryNormalizeRelayUrl } from './relays'
import type { ContentSegment, Hex, RelayUrl } from './types'

const BECH32 = '[qpzry9x8gf2tvdw0s3jn54khce6mua7l]'
const BECH32_UPPER = '[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]'

// No \p{...} and no lookbehind anywhere in this file: Hermes (React Native) does.
const HASHTAG_CHARS =
  'A-Za-z0-9_\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u0590-\\u05FF\\u0600-\\u06FF\\u3040-\\u30FF\\u4E00-\\u9FFF'

const TOKEN = new RegExp(
  [
    // NIP-21 URIs, and the bare form users paste from other clients.
    `(?:nostr:)?(?:nprofile|npub|nevent|note|naddr)1${BECH32}{6,}`,
    // Legacy NIP-27 positional reference into the event's own tags.
    '#\\[\\d+\\]',
    /** A NIP-30 shortcode. */
    ':[A-Za-z0-9_]+:',
    // Greedy to whitespace on purpose: "example.com/page#section" is one url, not a url.
    'https?:\\/\\/[^\\s<>"\'`]+',
    `(?:lightning:)?ln(?:bc|tb|bcrt)[0-9]*[munp]?1${BECH32}{20,}`,
    `(?:LIGHTNING:)?LN(?:BC|TB|BCRT)[0-9]*[MUNP]?1${BECH32_UPPER}{20,}`,
    '(?:cashu:|web\\+cashu:\\/\\/)?cashu[AB][A-Za-z0-9+/=_-]{10,}',
    `#[${HASHTAG_CHARS}]+`,
    /** A bare domain, written the way people actually write one: `nostrich.org`. */
    '(?:[A-Za-z0-9][A-Za-z0-9-]*\\.)+[A-Za-z]{2,24}(?::\\d{2,5})?(?:\\/[^\\s<>"\'`]*)?',
  ].join('|'),
  'g',
)

/** TLDs a bare domain is allowed to end. */
const LINKABLE_TLDS = new Set([
  // Generic, in rough order of how often they turn up in a note.
  'com', 'org', 'net', 'io', 'co', 'app', 'dev', 'xyz', 'info', 'biz', 'me', 'tv', 'cc',
  'ai', 'art', 'blog', 'cash', 'chat', 'club', 'digital', 'email', 'fm', 'fun', 'gg',
  'host', 'link', 'live', 'media', 'money', 'news', 'online', 'page', 'pro', 'pub',
  'shop', 'site', 'social', 'space', 'store', 'studio', 'tech', 'today', 'tools', 'wiki',
  'world', 'wtf', 'zone', 'network', 'finance', 'exchange', 'capital', 'fund', 'ventures',
  'agency', 'systems', 'solutions', 'technology', 'community', 'foundation', 'gov', 'edu',
  // Country codes common enough to be worth.
  'uk', 'de', 'fr', 'es', 'nl', 'ca', 'au', 'jp', 'br', 'ru', 'ch', 'se', 'no', 'fi', 'dk',
  'be', 'at', 'cz', 'gr', 'pt', 'ie', 'nz', 'za', 'mx', 'ar', 'cl', 'kr', 'sg', 'hk', 'tw',
  'il', 'tr', 'ua', 'in', 'eu',
])

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'])
/** Extensions treated as video. */
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])

/** Extensions treated as sound. */
const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac',
  'ogg',
  'oga',
  'opus',
  'weba',
])

/** The image a NIP-30 `emoji` tag gives a shortcode, if this event declared one. */
function emojiUrl(shortcode: string, tags: readonly (readonly string[])[]): string | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'emoji' || tag[1] !== shortcode) continue
    const url = tag[2]
    if (url === undefined) continue
    if (!/^https?:\/\//i.test(url)) continue
    return url
  }
  return undefined
}

/** Trailing characters that end sentences far more often than they end URLs. */
const URL_TRAILING = new Set(['.', ',', ';', ':', '!', '?', "'", '"', '*', '_', '~'])

interface Token {
  segment: ContentSegment
  /** May be shorter than the regex match when trailing punctuation was pushed back. */
  length: number
}

/** `tags` is only needed for notes from old clients, which reference mentions by index. */
/** Walk the content once, yielding each recognised token with where it sits. */
function* scanTokens(
  content: string,
  tags: readonly (readonly string[])[],
): Generator<{ segment: ContentSegment; start: number; length: number }> {
  TOKEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN.exec(content)) !== null) {
    const raw = match[0]
    const start = match.index
    const token = classify(raw, start, content, tags)
    if (token === undefined) {
      // Not a real token after all.
      TOKEN.lastIndex = start + 1
      continue
    }
    yield { segment: token.segment, start, length: token.length }
    TOKEN.lastIndex = start + token.length
  }
}

export function parseContent(content: string, tags: readonly (readonly string[])[] = []): ContentSegment[] {
  const segments: ContentSegment[] = []
  let cursor = 0

  const pushText = (value: string): void => {
    if (value === '') return
    const previous = segments[segments.length - 1]
    // Rejected matches leave text on both sides of the gap.
    if (previous !== undefined && previous.type === 'text') previous.value += value
    else segments.push({ type: 'text', value })
  }

  for (const { segment, start, length } of scanTokens(content, tags)) {
    pushText(content.slice(cursor, start))
    segments.push(segment)
    cursor = start + length
  }
  pushText(content.slice(cursor))
  return trimEdges(segments)
}

/** Blank lines at the TOP and BOTTOM of a note, removed. */
function trimEdges(segments: ContentSegment[]): ContentSegment[] {
  const first = segments[0]
  if (first !== undefined && first.type === 'text') {
    first.value = first.value.replace(/^[\s\u00a0]+/, '')
  }

  /* Walking back from the end, past MEDIA ONLY. */
  for (let at = segments.length - 1; at >= 0; at -= 1) {
    const segment = segments[at]
    if (segment === undefined) continue
    if (segment.type === 'image' || segment.type === 'video') continue
    if (segment.type === 'text') segment.value = segment.value.replace(/[\s\u00a0]+$/, '')
    break
  }

  // A run that was nothing but that whitespace has no text left to render.
  return segments.filter(segment => segment.type !== 'text' || segment.value !== '')
}

/** A note split into its media and everything else. */
/** Two blank lines become one, anywhere in a note. */
export function collapseBlankRuns(text: string): string {
  return text.replace(/(?:[^\S\n]*\n){3,}[^\S\n]*/gu, '\n\n')
}

/** ADJACENT TEXT SEGMENTS, REJOINED. */
export function mergeTextSegments(segments: readonly ContentSegment[]): ContentSegment[] {
  const out: ContentSegment[] = []
  for (const segment of segments) {
    const previous = out[out.length - 1]
    if (segment.type === 'text' && previous !== undefined && previous.type === 'text') {
      out[out.length - 1] = { type: 'text', value: previous.value + segment.value }
      continue
    }
    out.push(segment)
  }
  return out
}

export function splitMedia(segments: readonly ContentSegment[]): {
  media: ContentSegment[]
  rest: ContentSegment[]
} {
  const isMedia = (segment: ContentSegment | undefined): boolean =>
    segment !== undefined &&
    (segment.type === 'image' || segment.type === 'video' || segment.type === 'audio')

  const media: ContentSegment[] = []
  const rest: ContentSegment[] = []
  for (const [at, segment] of segments.entries()) {
    if (isMedia(segment)) {
      media.push(segment)
      continue
    }
    if (segment.type === 'text') {
      const beforeMedia = isMedia(segments[at + 1])
      const afterMedia = isMedia(segments[at - 1])
      if (beforeMedia || afterMedia) {
        // The whitespace that existed only to separate the media from the words.
        let value = segment.value
        if (afterMedia) value = value.replace(/^[\s\u00a0]+/, '')
        if (beforeMedia) value = value.replace(/[\s\u00a0]+$/, '')
        if (value === '') continue
        rest.push({ ...segment, value })
        continue
      }
    }
    rest.push(segment)
  }
  return { media, rest }
}

/** One stretch of the ORIGINAL text that will render as something other than plain text. */
export interface LinkRange {
  start: number
  /** Exclusive, so `content.slice(start, end)` is the substring as the author typed. */
  end: number
  type: ContentSegment['type']
}

/** Where the links are, in offsets into the text as typed. */
export function linkRanges(
  content: string,
  tags: readonly (readonly string[])[] = [],
): LinkRange[] {
  const ranges: LinkRange[] = []
  for (const { segment, start, length } of scanTokens(content, tags)) {
    if (segment.type === 'text') continue
    ranges.push({ start, end: start + length, type: segment.type })
  }
  return ranges
}

function classify(
  raw: string,
  start: number,
  content: string,
  tags: readonly (readonly string[])[],
): Token | undefined {
  const previousChar = start === 0 ? '' : content.charAt(start - 1)

  if (raw.startsWith(':') && raw.endsWith(':')) {
    /* The author's own declaration decides this, never the shape. */
    const shortcode = raw.slice(1, -1)
    const url = emojiUrl(shortcode, tags)
    if (url === undefined) return undefined
    return { segment: { type: 'emoji', shortcode, url }, length: raw.length }
  }

  if (raw.startsWith('#[')) {
    const index = Number.parseInt(raw.slice(2, -1), 10)
    const segment = resolveTagReference(index, tags)
    // An unresolvable "#[3]" stays as written: the author meant *something*, and showing.
    return segment === undefined ? undefined : { segment, length: raw.length }
  }

  if (raw.startsWith('#')) {
    if (/[A-Za-z0-9_#/]/.test(previousChar)) return undefined
    return { segment: { type: 'hashtag', tag: raw.slice(1) }, length: raw.length }
  }

  if (raw.startsWith('http')) {
    const url = trimUrl(raw)
    if (url === '') return undefined
    return { segment: urlSegment(url, tags), length: url.length }
  }

  const lower = raw.toLowerCase()

  if (lower.startsWith('lightning:') || lower.startsWith('lnbc') || lower.startsWith('lntb')) {
    const bolt11 = lower.startsWith('lightning:') ? lower.slice('lightning:'.length) : lower
    // Invoices are sometimes carried uppercase (bech32's compact QR mode).
    return { segment: { type: 'invoice', bolt11 }, length: raw.length }
  }

  if (lower.startsWith('cashu') || lower.startsWith('web+cashu://')) {
    // The scheme prefix contains the word "cashu" too.
    const token = /cashu[AB]/.exec(raw)
    if (token === null) return undefined
    return { segment: { type: 'cashu', token: raw.slice(token.index) }, length: raw.length }
  }

  /** A bare domain. */
  if (/^[A-Za-z0-9]/.test(raw) && raw.includes('.') && !raw.startsWith('nostr:')) {
    const host = raw.split('/')[0]?.split(':')[0] ?? ''
    const tld = host.slice(host.lastIndexOf('.') + 1).toLowerCase()
    if (LINKABLE_TLDS.has(tld)) {
      if (/[A-Za-z0-9_@./:-]/.test(previousChar)) return undefined
      const url = trimUrl(raw)
      if (url === '') return undefined
      // Stored with a scheme so it is fetchable and clickable.
      return { segment: urlSegment(`https://${url}`, tags), length: url.length }
    }
  }

  const bare = !raw.startsWith('nostr:')
  // A bare npub glued to a word or sitting inside a path is not a mention.
  if (bare && /[A-Za-z0-9_/:@.]/.test(previousChar)) return undefined
  const segment = decodeEntity(bare ? raw : raw.slice('nostr:'.length))
  return segment === undefined ? undefined : { segment, length: raw.length }
}

/** Invalid checksums are common (hand-typed, truncated by another UI) and must fall. */
function decodeEntity(code: string): ContentSegment | undefined {
  let decoded: ReturnType<typeof decode>
  try {
    decoded = decode(code)
  } catch {
    return undefined
  }
  switch (decoded.type) {
    case 'npub':
      return mentionSegment(decoded.data, code)
    case 'nprofile':
      return mentionSegment(decoded.data.pubkey, code, decoded.data.relays)
    case 'note':
      return eventSegment(decoded.data, code)
    case 'nevent':
      return eventSegment(decoded.data.id, code, decoded.data.relays, decoded.data.author)
    case 'naddr': {
      const pubkey = normalizeHex(decoded.data.pubkey)
      if (pubkey === undefined) return undefined
      // Validated here rather than at the point of use, exactly as `mentionSegment` does.
      const hints = (decoded.data.relays ?? [])
        .map(relay => tryNormalizeRelayUrl(relay))
        .filter((relay): relay is RelayUrl => relay !== undefined)
      return {
        type: 'address',
        kind: decoded.data.kind,
        pubkey,
        identifier: decoded.data.identifier,
        bech32: code,
        ...(hints.length === 0 ? {} : { relays: hints }),
      }
    }
    // nsec never reaches here.
    default:
      return undefined
  }
}

function mentionSegment(
  pubkey: string,
  bech32: string,
  relays?: readonly string[],
): ContentSegment | undefined {
  const hex = normalizeHex(pubkey)
  if (hex === undefined) return undefined
  // Normalised and validated here rather than at the point of use: a hint is a string.
  const hints = (relays ?? [])
    .map(relay => tryNormalizeRelayUrl(relay))
    .filter((relay): relay is RelayUrl => relay !== undefined)
  return hints.length === 0
    ? { type: 'mention', pubkey: hex, bech32 }
    : { type: 'mention', pubkey: hex, bech32, relays: hints }
}

function eventSegment(
  id: string,
  bech32: string,
  relays?: readonly string[],
  author?: string,
): ContentSegment | undefined {
  const hex = normalizeHex(id)
  if (hex === undefined) return undefined
  const hints = normalizeRelayHints(relays)
  const pubkey = author === undefined ? undefined : normalizeHex(author)
  return {
    type: 'event',
    id: hex,
    bech32,
    ...(hints.length === 0 ? {} : { relays: hints }),
    ...(pubkey === undefined ? {} : { author: pubkey }),
  }
}

function normalizeRelayHints(relays: readonly string[] | undefined): RelayUrl[] {
  const out: RelayUrl[] = []
  for (const relay of relays ?? []) {
    const url = tryNormalizeRelayUrl(relay)
    if (url !== undefined && !out.includes(url)) out.push(url)
  }
  return out
}

function resolveTagReference(index: number, tags: readonly (readonly string[])[]): ContentSegment | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined
  const tag = tags[index]
  if (tag === undefined) return undefined
  const name = tag[0]
  const value = tag[1]
  if (name === undefined || value === undefined) return undefined
  const relay = tag[2] === undefined || tag[2] === '' ? undefined : tryNormalizeRelayUrl(tag[2])
  try {
    if (name === 'p') {
      const pubkey = normalizeHex(value)
      if (pubkey === undefined) return undefined
      const bech32 = relay === undefined ? npubEncode(pubkey) : nprofileEncode({ pubkey, relays: [relay] })
      // A `p` tag's third field is the same kind of hint an `nprofile` carries.
      return relay === undefined
        ? { type: 'mention', pubkey, bech32 }
        : { type: 'mention', pubkey, bech32, relays: [relay] }
    }
    if (name === 'e') {
      const id = normalizeHex(value)
      if (id === undefined) return undefined
      if (relay === undefined) return { type: 'event', id, bech32: noteEncode(id) }
      return { type: 'event', id, bech32: neventEncode({ id, relays: [relay] }), relays: [relay] }
    }
    if (name === 'a') {
      const address = parseAddress(value)
      if (address === undefined) return undefined
      const bech32 = naddrEncode(relay === undefined ? address : { ...address, relays: [relay] })
      return { type: 'address', ...address, bech32 }
    }
  } catch {
    return undefined
  }
  return undefined
}

/** The MIME type the AUTHOR declared for a URL, from the note's NIP-92 `imeta` tag. */
function imetaMimeFor(tags: readonly (readonly string[])[], url: string): string | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue
    // NIP-92 fields are "key value" strings inside one tag, not separate array elements.
    let matches = false
    let mime: string | undefined
    for (const field of tag.slice(1)) {
      if (typeof field !== 'string') continue
      if (field.startsWith('url ') && field.slice(4).trim() === url) matches = true
      else if (field.startsWith('m ')) mime = field.slice(2).trim().toLowerCase()
    }
    if (matches && mime !== undefined) return mime
  }
  return undefined
}

function urlSegment(url: string, tags: readonly (readonly string[])[] = []): ContentSegment {
  const extension = extensionOf(url)
  /** Media gets its host repaired. */
  if (extension !== undefined && IMAGE_EXTENSIONS.has(extension)) {
    return { type: 'image', url: repairMediaUrl(url) }
  }
  if (extension !== undefined && VIDEO_EXTENSIONS.has(extension)) {
    return { type: 'video', url: repairMediaUrl(url) }
  }
  if (extension !== undefined && AUDIO_EXTENSIONS.has(extension)) {
    return { type: 'audio', url: repairMediaUrl(url) }
  }

  /* NO EXTENSION: ask the author. */
  if (extension === undefined) {
    const mime = imetaMimeFor(tags, url)
    if (mime !== undefined) {
      if (mime.startsWith('image/')) return { type: 'image', url: repairMediaUrl(url) }
      if (mime.startsWith('video/')) return { type: 'video', url: repairMediaUrl(url) }
      if (mime.startsWith('audio/')) return { type: 'audio', url: repairMediaUrl(url) }
    }
  }

  return { type: 'url', url }
}

/** Extension comes from the path only. */
function extensionOf(url: string): string | undefined {
  const path = url.split('#')[0]?.split('?')[0] ?? ''
  const slash = path.lastIndexOf('/')
  const file = slash === -1 ? path : path.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  if (dot <= 0 || dot === file.length - 1) return undefined
  return file.slice(dot + 1).toLowerCase()
}

function trimUrl(raw: string): string {
  let end = raw.length
  while (end > 0) {
    const char = raw.charAt(end - 1)
    if (URL_TRAILING.has(char)) {
      end -= 1
      continue
    }
    // Closing brackets belong to the URL when it opened them.
    if (char === ')' || char === ']') {
      const open = char === ')' ? '(' : '['
      const slice = raw.slice(0, end)
      if (countChar(slice, open) < countChar(slice, char)) {
        end -= 1
        continue
      }
    }
    break
  }
  return raw.slice(0, end)
}

function countChar(value: string, char: string): number {
  let count = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value.charAt(index) === char) count += 1
  }
  return count
}

/** Hashtags lowercased for `t` tags. */
export function hashtagsFromContent(content: string): string[] {
  const out: string[] = []
  for (const segment of parseContent(content)) {
    if (segment.type !== 'hashtag') continue
    const tag = segment.tag.toLowerCase()
    if (!out.includes(tag)) out.push(tag)
  }
  return out
}

export interface ContentReferences {
  pubkeys: Hex[]
  eventIds: Hex[]
  addresses: string[]
  hashtags: string[]
}

/** What the composer needs to turn a typed note into p/e/a/t tags. */
export function referencesFromContent(content: string, tags: readonly (readonly string[])[] = []): ContentReferences {
  const references: ContentReferences = { pubkeys: [], eventIds: [], addresses: [], hashtags: [] }
  for (const segment of parseContent(content, tags)) {
    switch (segment.type) {
      case 'mention':
        if (!references.pubkeys.includes(segment.pubkey)) references.pubkeys.push(segment.pubkey)
        break
      case 'event':
        if (!references.eventIds.includes(segment.id)) references.eventIds.push(segment.id)
        break
      case 'address': {
        const address = `${segment.kind}:${segment.pubkey}:${segment.identifier}`
        if (!references.addresses.includes(address)) references.addresses.push(address)
        break
      }
      case 'hashtag': {
        const tag = segment.tag.toLowerCase()
        if (!references.hashtags.includes(tag)) references.hashtags.push(tag)
        break
      }
      default:
        break
    }
  }
  return references
}

/** How much of a note is shown before "Show more". */
export const BODY_LIMIT = 280

/** A little slack, so a note barely over the limit is shown whole. */
const BODY_SLACK = 60

/** The visible prefix of a note, cut on SEGMENT boundaries. */
export function truncateSegments(segments: readonly ContentSegment[]): {
  shown: ContentSegment[]
  truncated: boolean
} {
  const total = segments.reduce(
    (sum, seg) => sum + (seg.type === 'text' ? seg.value.length : 0),
    0,
  )
  if (total <= BODY_LIMIT + BODY_SLACK) return { shown: [...segments], truncated: false }

  const shown: ContentSegment[] = []
  let used = 0
  for (const segment of segments) {
    if (segment.type !== 'text') {
      // A link or mention is atomic: it is taken whole or not at all, and it costs nothing.
      shown.push(segment)
      continue
    }
    const room = BODY_LIMIT - used
    if (room <= 0) break
    if (segment.value.length <= room) {
      shown.push(segment)
      used += segment.value.length
      continue
    }
    // Cut back to the last space so the last word is whole rather than beheaded.
    const slice = segment.value.slice(0, room)
    const lastSpace = slice.lastIndexOf(' ')
    shown.push({ ...segment, value: (lastSpace > room * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd() })
    used = BODY_LIMIT
    break
  }
  return { shown, truncated: true }
}
