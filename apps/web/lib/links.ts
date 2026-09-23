import { encodeNevent, encodeNote, type NostrEvent } from '@nostrich/nostr'

/** Where a nostr: entity points. */
const RESOLVER = 'https://njump.me'

/** npub/nprofile → /p/…, note/nevent → /e/…, anything else → njump. */
export function isInternalEntity(bech32: string): boolean {
  return /^(npub|nprofile|note|nevent)1/.test(bech32)
}

export function entityHref(bech32: string): string {
  if (/^(npub|nprofile)1/.test(bech32)) return `/p/${encodeURIComponent(bech32)}`
  if (/^(note|nevent)1/.test(bech32)) return `/e/${encodeURIComponent(bech32)}`
  return `${RESOLVER}/${encodeURIComponent(bech32)}`
}

export function profileHref(pubkeyOrBech32: string): string {
  return `/p/${encodeURIComponent(pubkeyOrBech32)}`
}

export function hashtagHref(tag: string): string {
  return `/?t=${encodeURIComponent(tag.toLowerCase())}`
}

/** An nevent carries the author alongside the id, so a client that has never seen. */
export function noteHref(event: Pick<NostrEvent, 'id' | 'pubkey'>): string {
  try {
    return entityHref(encodeNevent({ id: event.id, author: event.pubkey }))
  } catch {
    try {
      return entityHref(encodeNote(event.id))
    } catch {
      return entityHref(event.id)
    }
  }
}

/** Hashtags arrive from the URL bar as well as from note content. */
export function normalizeHashtag(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const tag = value.trim().replace(/^#+/, '').toLowerCase()
  // Whitespace inside a tag makes it unmatchable: relays index `#t` values verbatim.
  if (tag === '' || tag.length > 64 || /\s/.test(tag)) return null
  return tag
}

/** How a href in user content must be rendered. */
export type LinkKind =
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string; target: '_blank'; rel: string }
  /** A scheme we will not put behind an anchor. */
  | { kind: 'refused' }

/** Everything an outbound link in user content carries. */
const EXTERNAL_REL = 'noopener noreferrer nofollow ugc'

/** Schemes allowed to leave the app. */
const EXTERNAL_SCHEMES = ['http:', 'https:', 'lightning:', 'mailto:']

export function linkKind(href: string): LinkKind {
  const value = href.trim()
  if (value === '') return { kind: 'refused' }

  /** A single leading slash is ours. */
  if (value.startsWith('/') && !value.startsWith('//')) return { kind: 'internal', href: value }

  /** A protocol-relative URL is resolved rather than refused. */
  const absolute = value.startsWith('//') ? `https:${value}` : value

  let parsed: URL
  try {
    parsed = new URL(absolute)
  } catch {
    // Not a URL at all.
    return { kind: 'refused' }
  }
  if (!EXTERNAL_SCHEMES.includes(parsed.protocol)) return { kind: 'refused' }

  return { kind: 'external', href: absolute, target: '_blank', rel: EXTERNAL_REL }
}
