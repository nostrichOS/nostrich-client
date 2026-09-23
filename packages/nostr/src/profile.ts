/** Kind-0 metadata. */

import { npubEncode } from 'nostr-tools/nip19'
import { secureMediaUrl } from './moved-hosts'

import { buildMetadata, KINDS, normalizeHex, type BuildOptions, type MetadataContent } from './events'
import type { EventTemplate, Hex, NostrEvent, Profile } from './types'

/** Field ceilings. */
const LIMIT = {
  name: 256,
  about: 8192,
  url: 2048,
  identifier: 320,
} as const

export type ProfileFields = Omit<Profile, 'pubkey' | 'updatedAt'>

export function parseProfile(event: NostrEvent): Profile {
  const pubkey = normalizeHex(event.pubkey) ?? event.pubkey.toLowerCase()
  const updatedAt = Number.isFinite(event.created_at) ? event.created_at : 0
  return { pubkey, updatedAt, ...parseProfileContent(event.content) }
}

export function parseProfileContent(content: string): ProfileFields {
  const raw = parseJsonObject(content)
  if (raw === undefined) return {}

  const fields: ProfileFields = {}
  const name = asString(raw['name'], LIMIT.name)
  if (name !== undefined) fields.name = name

  // `display_name` is the NIP-01 spelling.
  const displayName = asString(raw['display_name'], LIMIT.name) ?? asString(raw['displayName'], LIMIT.name)
  if (displayName !== undefined) fields.displayName = displayName

  const about = asString(raw['about'], LIMIT.about)
  if (about !== undefined) fields.about = about

  // Upgraded to https, like note media.
  const picture = asUrl(raw['picture'])
  if (picture !== undefined) fields.picture = secureMediaUrl(picture)

  const banner = asUrl(raw['banner'])
  if (banner !== undefined) fields.banner = secureMediaUrl(banner)

  const nip05 = asNip05(raw['nip05'])
  if (nip05 !== undefined) fields.nip05 = nip05

  const website = asWebsite(raw['website'])
  if (website !== undefined) fields.website = website

  const lud06 = asString(raw['lud06'], LIMIT.identifier)
  const lud16 = asString(raw['lud16'], LIMIT.identifier)
  // Plenty of profiles put an LNURL in the lud16 slot.
  if (lud16 !== undefined && lud16.toLowerCase().startsWith('lnurl1')) {
    fields.lud06 = lud06 ?? lud16.toLowerCase()
  } else {
    if (lud16 !== undefined) fields.lud16 = lud16.toLowerCase()
    if (lud06 !== undefined) fields.lud06 = lud06
  }

  return fields
}

/** Whole-document replace, never a field-level merge: kind 0 is replaceable. */
export function mergeProfiles(current: Profile | undefined, incoming: Profile): Profile {
  if (current === undefined) return incoming
  // Merging across pubkeys is always a caller bug, and a swapped identity in a cache.
  if (current.pubkey !== incoming.pubkey) return current
  return incoming.updatedAt > current.updatedAt ? incoming : current
}

/** NIP-01 tie-break for replaceable events: newest wins, and on equal `created_at`. */
export function pickLatestMetadata(events: readonly NostrEvent[]): NostrEvent | undefined {
  let best: NostrEvent | undefined
  for (const event of events) {
    if (event.kind !== KINDS.metadata) continue
    if (best === undefined) {
      best = event
      continue
    }
    if (event.created_at > best.created_at) best = event
    else if (event.created_at === best.created_at && event.id < best.id) best = event
  }
  return best
}

export interface ProfileTemplateOptions extends BuildOptions {
  /** Fields from the profile's previous kind-0 that this app does not model. */
  preserve?: MetadataContent
}

/** UNDEFINED MEANS "NOT MINE TO WRITE". */
export function profileToTemplate(profile: Profile, options: ProfileTemplateOptions = {}): EventTemplate {
  const { preserve, ...build } = options
  const content: MetadataContent = { ...preserve }
  const set = (key: string, value: string | undefined): void => {
    if (value === undefined) return
    content[key] = value
  }
  set('name', profile.name)
  set('display_name', profile.displayName)
  set('about', profile.about)
  set('picture', profile.picture)
  set('banner', profile.banner)
  set('nip05', profile.nip05)
  set('lud16', profile.lud16)
  set('lud06', profile.lud06)
  set('website', profile.website)
  return buildMetadata(content, build)
}

/** The @handle, without the '@'. */
export function profileHandle(
  profile: Partial<Pick<ProfileFields, 'name' | 'nip05'>> | null | undefined,
): string | undefined {
  const name = profile?.name?.trim()
  if (name !== undefined && name !== '') return name
  const nip05 = profile?.nip05?.trim()
  if (nip05 === undefined || nip05 === '') return undefined
  const [local, domain] = nip05.split('@')
  // `_@domain` is NIP-05's "the domain itself" form, so the domain IS the name there.
  if (local !== undefined && local !== '' && local !== '_') return local
  return domain !== undefined && domain !== '' ? domain : undefined
}

/** What to put on screen when a profile is empty or was never fetched. */
export function profileDisplayName(profile: Pick<Profile, 'pubkey'> & Partial<ProfileFields>): string {
  const chosen = profile.displayName ?? profile.name
  if (chosen !== undefined && chosen.trim() !== '') return chosen.trim()
  return shortNpub(profile.pubkey)
}

export function shortNpub(pubkey: Hex): string {
  const hex = normalizeHex(pubkey)
  if (hex === undefined) return 'unknown'
  try {
    const npub = npubEncode(hex)
    return `${npub.slice(0, 10)}…${npub.slice(-6)}`
  } catch {
    return 'unknown'
  }
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  if (content === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return undefined
  }
  // Some clients ship the metadata double-encoded: a JSON string containing JSON.
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return undefined
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

function asString(value: unknown, limit: number): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed.slice(0, limit)
}

/** Profile URLs land in `<img src>` and `<a href>` on web and in image loaders. */
function asUrl(value: unknown): string | undefined {
  const text = asString(value, LIMIT.url)
  if (text === undefined) return undefined
  return /^https?:\/\/\S+$/i.test(text) ? text : undefined
}

function asWebsite(value: unknown): string | undefined {
  const text = asString(value, LIMIT.url)
  if (text === undefined) return undefined
  // Users type "example.com" far more often than they type a scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  return asUrl(withScheme)
}

function asNip05(value: unknown): string | undefined {
  const text = asString(value, LIMIT.identifier)
  if (text === undefined) return undefined
  const lower = text.toLowerCase()
  // A bare domain means the root name: "example.com" is "_@example.com".
  const identifier = lower.includes('@') ? lower : `_@${lower}`
  return /^[a-z0-9\-_.]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(identifier) ? identifier : undefined
}
