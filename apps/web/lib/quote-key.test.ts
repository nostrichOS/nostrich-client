import { describe, expect, it } from 'vitest'
import type { Hex, RelayUrl } from '@nostrich/nostr'

import type { QuotePointer } from '../components/QuotedNote'

import { quotedNoteKey } from './quote-key'

/** The key a warmed quote is seeded. */

const ID = 'a'.repeat(64) as Hex
const AUTHOR = 'b'.repeat(64) as Hex
const pointer = (over: Partial<QuotePointer> = {}): QuotePointer =>
  ({ id: ID, relays: [], ...over }) as QuotePointer

describe('quotedNoteKey', () => {
  it('separates a pointer that names an author from one that does not', () => {
    expect(quotedNoteKey(pointer())).not.toEqual(quotedNoteKey(pointer({ author: AUTHOR })))
  })

  it('is stable across hint ordering, so the same quote is one cache entry', () => {
    const a = ['wss://one.example' as RelayUrl, 'wss://two.example' as RelayUrl]
    expect(quotedNoteKey(pointer({ relays: a }))).toEqual(
      quotedNoteKey(pointer({ relays: [...a].reverse() })),
    )
  })

  it('separates pointers carrying different hints', () => {
    expect(quotedNoteKey(pointer({ relays: ['wss://one.example' as RelayUrl] }))).not.toEqual(
      quotedNoteKey(pointer({ relays: ['wss://two.example' as RelayUrl] })),
    )
  })

  it('answers for no pointer at all rather than throwing', () => {
    expect(quotedNoteKey(undefined)).toEqual(['quoted-note', '', '', ''])
  })
})
