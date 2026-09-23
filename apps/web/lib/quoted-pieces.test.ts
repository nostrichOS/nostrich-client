import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import { plainText, quotedPieces } from './quoted-pieces'

/** The blank line a removed quote leaves behind. */

const NEVENT =
  'nevent1qgsgydql3q4ka27d9wnlrmus4tvkrnc8ftc4h8h5fgyln54gl0a7dgsqyrfl2z09adkaqmuk63uhj62q3a0eey8fydlszturzv93lfvjkfjrxelysq8'

const note = (content: string): NostrEvent =>
  ({ id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 1, created_at: 1, tags: [], content, sig: '' }) as NostrEvent

describe('quotedPieces', () => {
  it('leaves no trailing blank line where the quote reference was', () => {
    expect(plainText(note(`give it a try.\n\nnostr:${NEVENT}`))).toBe('give it a try.')
  })

  it('leaves no leading blank line either', () => {
    expect(plainText(note(`nostr:${NEVENT}\n\nafter the quote`))).toBe('after the quote')
  })

  it('KEEPS the author own blank line between paragraphs', () => {
    expect(plainText(note(`first para\n\nsecond para\n\nnostr:${NEVENT}`))).toBe(
      'first para\n\nsecond para',
    )
  })

  it('is empty when the note was nothing but the quote', () => {
    expect(plainText(note(`nostr:${NEVENT}`))).toBe('')
  })

  it('does not eat ordinary trailing punctuation or emoji', () => {
    expect(plainText(note(`almost there 🔥\n\nnostr:${NEVENT}`))).toBe('almost there 🔥')
  })

  it('leaves a note with no quote at all untouched apart from its own edges', () => {
    expect(plainText(note('just a note'))).toBe('just a note')
  })

  it('keeps a mention as a piece rather than trimming it away', () => {
    const pieces = quotedPieces(note(`hi\n\nnostr:${NEVENT}`))
    expect(pieces.every(piece => typeof piece !== 'string' || piece.trim() !== '' || pieces.length === 1)).toBe(true)
  })
})

describe('links in a quoted note', () => {
  it('keeps a URL as its own piece, so the card can make it an anchor', () => {
    const pieces = quotedPieces(note('read this https://example.com/post and tell me'))
    expect(pieces).toContainEqual({ url: 'https://example.com/post' })
  })

  it('still drops the one URL the card below is already showing', () => {
    const pieces = quotedPieces(note('see https://example.com/post'), 'https://example.com/post')
    expect(pieces.some(p => typeof p === 'object' && 'url' in p)).toBe(false)
  })

  it('reads back as itself in plain text, where there is no anchor to make', () => {
    expect(plainText(note('read https://example.com/post now'))).toBe('read https://example.com/post now')
  })
})
