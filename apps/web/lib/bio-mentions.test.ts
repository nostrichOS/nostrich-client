import { describe, expect, it } from 'vitest'
import type { Hex } from '@nostrich/nostr'

import { mentionedPubkeys, toEditableBio } from './bio-mentions'

/** A bio is stored as keys and edited as names, and this is the way back. */

// `npub1gkkahxw…` is a real, decodable key: the pointer parser is the thing under test.
const NPUB = 'npub1gkkahxwca30rf2td22u9p3jnmlh79dylgmm2et0kykftle6tdcysj4zden'
const HEX = '45addb99d8ec5e34a96d52b850c653dfefe2b49f46f6acadf62592bfe74b6e09' as Hex

describe('mentionedPubkeys', () => {
  it('finds the account a stored bio points at', () => {
    expect(mentionedPubkeys(`dev nostr:${NPUB}, running #bitcoin`)).toEqual([HEX])
  })

  it('returns nothing for a bio with no pointers', () => {
    expect(mentionedPubkeys('dev @btcframe, running #bitcoin')).toEqual([])
    expect(mentionedPubkeys('')).toEqual([])
  })

  it('lists one account once, however often it is named', () => {
    expect(mentionedPubkeys(`nostr:${NPUB} and again nostr:${NPUB}`)).toEqual([HEX])
  })

  it('ignores a pointer it cannot decode rather than throwing', () => {
    expect(mentionedPubkeys('nostr:npub1thisisnotarealkeyatallxxxxxxxxxxxxxx')).toEqual([])
  })
})

describe('toEditableBio', () => {
  const names = (pubkey: Hex): string | undefined => (pubkey === HEX ? 'btcframe' : undefined)

  it('shows the handle and remembers the key behind it', () => {
    const out = toEditableBio(`dev nostr:${NPUB}, running #bitcoin`, names)
    expect(out.text).toBe('dev @btcframe, running #bitcoin')
    expect(out.bindings).toEqual({ '@btcframe': HEX })
  })

  it('keeps the punctuation around it untouched', () => {
    // The comma directly after the pointer is what the author typed.
    const out = toEditableBio(`nostr:${NPUB},`, names)
    expect(out.text).toBe('@btcframe,')
  })

  it('leaves a key it cannot name as the pointer', () => {
    // A truncated npub would be no more readable AND would lose the binding on save.
    const out = toEditableBio(`hi nostr:${NPUB}`, () => undefined)
    expect(out.text).toBe(`hi nostr:${NPUB}`)
    expect(out.bindings).toEqual({})
  })

  it('leaves a bio with no pointers exactly as it is', () => {
    const bio = 'dev @btcframe, running #bitcoin. building https://nostrich.org'
    expect(toEditableBio(bio, names).text).toBe(bio)
  })

  it('handles the same account twice', () => {
    const out = toEditableBio(`nostr:${NPUB} and nostr:${NPUB}`, names)
    expect(out.text).toBe('@btcframe and @btcframe')
    expect(out.bindings).toEqual({ '@btcframe': HEX })
  })
})
