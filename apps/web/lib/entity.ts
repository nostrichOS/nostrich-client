import { decodePointer, normalizeHexKey, type Hex, type RelayUrl } from '@nostrich/nostr'

/** Turn whatever is in a `/p/[id]` or `/e/[id]` URL into hex. */
export interface ResolvedEntity {
  kind: 'profile' | 'event'
  hex: Hex
  /** Author, when the pointer carried one (nevent). */
  author?: Hex
  relays: RelayUrl[]
}

export function resolveEntity(
  raw: string | undefined,
  expect: 'profile' | 'event',
): ResolvedEntity | null {
  if (raw === undefined) return null
  let value: string
  try {
    value = decodeURIComponent(raw).trim()
  } catch {
    // A malformed percent-escape is a bad URL, not a crash.
    return null
  }
  if (value === '') return null

  // Raw hex is ambiguous between a pubkey and an event id.
  const hex = normalizeHexKey(value)
  if (hex !== null) return { kind: expect, hex, relays: [] }

  let pointer
  try {
    pointer = decodePointer(value)
  } catch {
    return null
  }

  switch (pointer.type) {
    case 'npub':
      return expect === 'profile' ? { kind: 'profile', hex: pointer.pubkey, relays: [] } : null
    case 'nprofile':
      return expect === 'profile'
        ? { kind: 'profile', hex: pointer.pubkey, relays: pointer.relays }
        : null
    case 'note':
      return expect === 'event' ? { kind: 'event', hex: pointer.id, relays: [] } : null
    case 'nevent':
      return expect === 'event'
        ? {
            kind: 'event',
            hex: pointer.id,
            ...(pointer.author === undefined ? {} : { author: pointer.author }),
            relays: pointer.relays,
          }
        : null
    default:
      // naddr and anything added later.
      return null
  }
}
