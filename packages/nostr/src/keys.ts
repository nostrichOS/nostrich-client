/** The edge where bech32 becomes hex and back. */

import { hexToBytes } from '@noble/hashes/utils'
import * as nip19 from 'nostr-tools/nip19'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

import type { Hex, RelayUrl } from './types'

const HEX_64 = /^[0-9a-f]{64}$/

export class InvalidKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidKeyError'
  }
}

// Error messages never quote the offending value.
function fail(message: string, input: string): never {
  throw new InvalidKeyError(`${message} (received ${input.length} characters)`)
}

export interface KeyPair {
  /** Raw 32-byte secret. */
  secretKey: Uint8Array
  publicKey: Hex
}

export function generateKeyPair(): KeyPair {
  const secretKey = generateSecretKey()
  return { secretKey, publicKey: getPublicKey(secretKey) }
}

export function derivePublicKey(secretKey: Uint8Array): Hex {
  if (secretKey.length !== 32) {
    throw new InvalidKeyError(`secret key must be 32 bytes, got ${secretKey.length}`)
  }
  return publicKeyOf(secretKey)
}

function publicKeyOf(secretKey: Uint8Array): Hex {
  try {
    return getPublicKey(secretKey)
  } catch {
    // Zero, or above the curve order.
    throw new InvalidKeyError('secret key is not a valid secp256k1 scalar')
  }
}

export function isHexKey(value: unknown): value is Hex {
  return typeof value === 'string' && HEX_64.test(value)
}

/** Accepts the uppercase hex some relays and QR codes hand out. */
export function normalizeHexKey(value: string): Hex | null {
  const candidate = value.trim().toLowerCase()
  return HEX_64.test(candidate) ? candidate : null
}

export function assertHexKey(value: string, label = 'key'): Hex {
  const normalized = normalizeHexKey(value)
  if (normalized === null) fail(`${label} must be 64 hex characters`, value)
  return normalized
}

// --------------------------------------------------------------------------- NIP-19.

export interface EventPointer {
  id: Hex
  relays?: RelayUrl[]
  author?: Hex
  kind?: number
}

export interface AddressPointer {
  kind: number
  pubkey: Hex
  identifier: string
  relays?: RelayUrl[]
}

export interface ProfilePointer {
  pubkey: Hex
  relays?: RelayUrl[]
}

export type Nip19Pointer =
  | { type: 'npub'; pubkey: Hex }
  | { type: 'note'; id: Hex }
  | { type: 'nprofile'; pubkey: Hex; relays: RelayUrl[] }
  | { type: 'nevent'; id: Hex; relays: RelayUrl[]; author?: Hex; kind?: number }
  | { type: 'naddr'; kind: number; pubkey: Hex; identifier: string; relays: RelayUrl[] }

function decodeBech32(value: string) {
  // `nostr:` prefixes arrive from note content, deep links and QR codes alike.
  const trimmed = value.trim().replace(/^nostr:/i, '')
  try {
    return nip19.decode(trimmed)
  } catch {
    fail('not a valid NIP-19 identifier', trimmed)
  }
}

export function encodeNpub(pubkey: Hex): string {
  return nip19.npubEncode(assertHexKey(pubkey, 'pubkey'))
}

export function decodeNpub(npub: string): Hex {
  const decoded = decodeBech32(npub)
  if (decoded.type !== 'npub') throw new InvalidKeyError(`expected an npub, got ${decoded.type}`)
  return decoded.data
}

export function encodeNsec(secretKey: Uint8Array): string {
  if (secretKey.length !== 32) {
    throw new InvalidKeyError(`secret key must be 32 bytes, got ${secretKey.length}`)
  }
  return nip19.nsecEncode(secretKey)
}

export function decodeNsec(nsec: string): Uint8Array {
  const decoded = decodeBech32(nsec)
  if (decoded.type !== 'nsec') throw new InvalidKeyError(`expected an nsec, got ${decoded.type}`)
  return decoded.data
}

export function encodeNote(id: Hex): string {
  return nip19.noteEncode(assertHexKey(id, 'event id'))
}

export function decodeNote(note: string): Hex {
  const decoded = decodeBech32(note)
  if (decoded.type !== 'note') throw new InvalidKeyError(`expected a note, got ${decoded.type}`)
  return decoded.data
}

export function encodeNevent(pointer: EventPointer): string {
  return nip19.neventEncode({
    id: assertHexKey(pointer.id, 'event id'),
    relays: pointer.relays,
    author: pointer.author === undefined ? undefined : assertHexKey(pointer.author, 'author'),
    kind: pointer.kind,
  })
}

export function encodeNaddr(pointer: AddressPointer): string {
  return nip19.naddrEncode({
    kind: pointer.kind,
    pubkey: assertHexKey(pointer.pubkey, 'pubkey'),
    identifier: pointer.identifier,
    relays: pointer.relays,
  })
}

export function encodeNprofile(pointer: ProfilePointer): string {
  return nip19.nprofileEncode({
    pubkey: assertHexKey(pointer.pubkey, 'pubkey'),
    relays: pointer.relays,
  })
}

/** Decode any pointer-shaped NIP-19 string. */
export function decodePointer(value: string): Nip19Pointer {
  const decoded = decodeBech32(value)
  switch (decoded.type) {
    case 'npub':
      return { type: 'npub', pubkey: decoded.data }
    case 'note':
      return { type: 'note', id: decoded.data }
    case 'nprofile':
      return { type: 'nprofile', pubkey: decoded.data.pubkey, relays: decoded.data.relays ?? [] }
    case 'nevent':
      return {
        type: 'nevent',
        id: decoded.data.id,
        relays: decoded.data.relays ?? [],
        author: decoded.data.author,
        kind: decoded.data.kind,
      }
    case 'naddr':
      return {
        type: 'naddr',
        kind: decoded.data.kind,
        pubkey: decoded.data.pubkey,
        identifier: decoded.data.identifier,
        relays: decoded.data.relays ?? [],
      }
    case 'nsec':
      throw new InvalidKeyError('refusing to decode an nsec as a pointer')
  }
}

/** hex | npub | nprofile → hex. */
export function toPubkey(value: string): Hex {
  const hex = normalizeHexKey(value)
  if (hex !== null) return hex
  const pointer = decodePointer(value)
  if (pointer.type === 'npub' || pointer.type === 'nprofile') return pointer.pubkey
  throw new InvalidKeyError(`expected a pubkey, got ${pointer.type}`)
}

/** hex | note | nevent → hex. */
export function toEventId(value: string): Hex {
  const hex = normalizeHexKey(value)
  if (hex !== null) return hex
  const pointer = decodePointer(value)
  if (pointer.type === 'note' || pointer.type === 'nevent') return pointer.id
  throw new InvalidKeyError(`expected an event id, got ${pointer.type}`)
}

// --------------------------------------------------------------------------- nostr.

export interface NostrUriParts {
  /** Everything between the scheme and the query. */
  authority: string
  params: Array<[string, string]>
  /** `relay=` values, normalised. Both schemes repeat the key rather than list. */
  relays: RelayUrl[]
}

function normalizeRelayUrl(value: string): RelayUrl | null {
  const trimmed = value.trim()
  if (!/^wss?:\/\//i.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    // Relays are compared as strings all over this codebase, so a stray trailing slash.
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}${url.search}`
  } catch {
    return null
  }
}

function parseQuery(query: string): Array<[string, string]> {
  return query
    .split('&')
    .filter(pair => pair.length > 0)
    .map((pair): [string, string] => {
      const eq = pair.indexOf('=')
      const key = eq === -1 ? pair : pair.slice(0, eq)
      const value = eq === -1 ? '' : pair.slice(eq + 1)
      try {
        return [decodeURIComponent(key), decodeURIComponent(value)]
      } catch {
        // Signers in the wild emit unencoded relay URLs.
        return [key, value]
      }
    })
}

/** Split a nostr URI by hand instead of with `new URL()`. */
export function parseNostrUri(uri: string, scheme: 'bunker' | 'nostrconnect'): NostrUriParts {
  const trimmed = uri.trim()
  const prefix = `${scheme}://`
  if (!trimmed.toLowerCase().startsWith(prefix)) fail(`expected a ${prefix} URI`, trimmed)

  const rest = trimmed.slice(prefix.length)
  const split = rest.indexOf('?')
  const authority = (split === -1 ? rest : rest.slice(0, split)).replace(/\/+$/, '')
  const params = parseQuery(split === -1 ? '' : rest.slice(split + 1))
  const relays = params
    .filter(([key]) => key === 'relay')
    .map(([, value]) => normalizeRelayUrl(value))
    .filter((url): url is RelayUrl => url !== null)

  return { authority, params, relays }
}

export interface BunkerPointer {
  /** The signer's own key. NOT necessarily the identity it signs. */
  remoteSignerPubkey: Hex
  relays: RelayUrl[]
  /** Single-use pairing token. */
  secret?: string
}

export function parseBunkerUri(uri: string): BunkerPointer {
  const { authority, params, relays } = parseNostrUri(uri, 'bunker')
  // Spec says hex, but bunkers hand out npub-flavoured URIs often enough to matter.
  const remoteSignerPubkey = toPubkey(authority)
  if (relays.length === 0) {
    throw new InvalidKeyError('bunker URI has no usable relay=; there is nowhere to reach the signer')
  }
  const secret = params.find(([key]) => key === 'secret')?.[1]
  return { remoteSignerPubkey, relays, secret }
}

// --------------------------------------------------------------------------- Login.

export type ParsedKeyInput =
  | { kind: 'privatekey'; secretKey: Uint8Array; publicKey: Hex }
  | { kind: 'bunker'; pointer: BunkerPointer }
  | { kind: 'pubkey'; publicKey: Hex; relays: RelayUrl[] }

/** Classify whatever landed in the login field. */
export function parseKeyInput(input: string): ParsedKeyInput {
  const value = input.trim().replace(/^nostr:/i, '')
  if (value.length === 0) throw new InvalidKeyError('nothing to parse')

  if (value.toLowerCase().startsWith('bunker://')) {
    return { kind: 'bunker', pointer: parseBunkerUri(value) }
  }

  if (value.startsWith('nsec1')) {
    const secretKey = decodeNsec(value)
    return { kind: 'privatekey', secretKey, publicKey: publicKeyOf(secretKey) }
  }

  if (value.startsWith('npub1') || value.startsWith('nprofile1')) {
    const pointer = decodePointer(value)
    if (pointer.type === 'npub') return { kind: 'pubkey', publicKey: pointer.pubkey, relays: [] }
    if (pointer.type === 'nprofile') {
      return { kind: 'pubkey', publicKey: pointer.pubkey, relays: pointer.relays }
    }
    throw new InvalidKeyError(`expected a pubkey, got ${pointer.type}`)
  }

  const hex = normalizeHexKey(value)
  if (hex !== null) {
    // A bare 64-char hex string is shaped identically as a secret key and as a pubkey.
    const secretKey = hexToBytes(hex)
    return { kind: 'privatekey', secretKey, publicKey: publicKeyOf(secretKey) }
  }

  fail('expected an nsec, a hex secret key, an npub, an nprofile or a bunker:// URI', value)
}
