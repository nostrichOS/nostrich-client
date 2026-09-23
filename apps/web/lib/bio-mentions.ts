'use client'

import { decodePointer, type Hex } from '@nostrich/nostr'

/** A stored bio is keys. */

/** `nostr:` followed by an npub or an nprofile. */
const MENTION_URI = /nostr:(npub1[a-z0-9]{20,}|nprofile1[a-z0-9]{20,})/gi

/** Every account a bio points at, in the order they appear. */
export function mentionedPubkeys(about: string): Hex[] {
  const out: Hex[] = []
  MENTION_URI.lastIndex = 0
  for (let match = MENTION_URI.exec(about); match !== null; match = MENTION_URI.exec(about)) {
    const bech32 = match[1]
    if (bech32 === undefined) continue
    try {
      const pointer = decodePointer(bech32)
      if (pointer.type !== 'npub' && pointer.type !== 'nprofile') continue
      if (!out.includes(pointer.pubkey)) out.push(pointer.pubkey)
    } catch {
      // Not a pointer we can read.
    }
  }
  return out
}

export interface EditableBio {
  /** The text to put in the field. */
  text: string
  /** `@handle` -> pubkey, to seed the mention field so a save resolves them again. */
  bindings: Record<string, string>
}

/** Swap each `nostr:` pointer for `@handle`, using whatever names the caller could. */
export function toEditableBio(about: string, nameFor: (pubkey: Hex) => string | undefined): EditableBio {
  const bindings: Record<string, string> = {}
  MENTION_URI.lastIndex = 0

  const text = about.replace(MENTION_URI, (whole, bech32: string) => {
    let pubkey: Hex
    try {
      const pointer = decodePointer(bech32)
      if (pointer.type !== 'npub' && pointer.type !== 'nprofile') return whole
      pubkey = pointer.pubkey
    } catch {
      return whole
    }
    const name = nameFor(pubkey)?.trim()
    if (name === undefined || name === '') return whole
    const token = `@${name}`
    bindings[token] = pubkey
    return token
  })

  return { text, bindings }
}
