import { describe, expect, it } from 'vitest'

import {
  MAX_GROUP_MARKS,
  reactionFlavour,
  reactionMarkOf,
  reactionVerb,
  summariseMarks,
} from './reactions'

/** The bug this file guards: a notification row that says eleven people "liked your. */
describe('reactionFlavour', () => {
  it('reads a like as a like, including the empty content NIP-25 defines as one', () => {
    for (const content of ['+', '', '  ', '  +  ', undefined]) {
      expect(reactionFlavour(content)).toBe('like')
    }
  })

  it('reads a downvote as a dislike', () => {
    expect(reactionFlavour('-')).toBe('dislike')
  })

  it('reads everything else as the emoji it is', () => {
    for (const content of ['🤙', '💯', '❤️', ':pepe:', 'lgtm']) {
      expect(reactionFlavour(content)).toBe('emoji')
    }
  })
})

describe('reactionMarkOf', () => {
  const tag = (shortcode: string, url: string) => [['emoji', shortcode, url]]

  it('has no mark for a like or a dislike, those are said in words', () => {
    expect(reactionMarkOf('+', [])).toBeUndefined()
    expect(reactionMarkOf('-', [])).toBeUndefined()
  })

  it('resolves a NIP-30 shortcode against the tag that names it', () => {
    expect(reactionMarkOf(':pepe:', tag('pepe', 'https://cdn.example/pepe.png'))).toEqual({
      display: ':pepe:',
      url: 'https://cdn.example/pepe.png',
    })
  })

  it('falls back to the literal text when no tag names it', () => {
    expect(reactionMarkOf(':pepe:', [])).toEqual({ display: ':pepe:' })
    expect(reactionMarkOf(':pepe:', tag('other', 'https://cdn.example/x.png'))).toEqual({
      display: ':pepe:',
    })
  })

  /** The URL is written by a stranger and lands in an <img src>. */
  it('refuses a URL that is not http(s)', () => {
    for (const url of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///etc/passwd']) {
      expect(reactionMarkOf(':x:', tag('x', url))).toEqual({ display: ':x:' })
    }
  })

  it('keeps whole characters when it trims', () => {
    // A family is one character made of seven code points.
    expect(reactionMarkOf('👨‍👩‍👧‍👦', [])).toEqual({ display: '👨‍👩‍👧‍👦' })
    expect(reactionMarkOf('🇯🇵🇺🇸', [])).toEqual({ display: '🇯🇵🇺🇸' })
    expect(reactionMarkOf('🤙🤙🤙', [])).toEqual({ display: '🤙🤙' })
  })

  it('trims a paragraph somebody put in the content field', () => {
    expect(reactionMarkOf('this is not a reaction, it is an essay', [])?.display).toBe('th')
  })
})

describe('summariseMarks', () => {
  const of = (content: string, tags: string[][] = []) => ({ content, tags })

  it('orders by how many were sent, not by when', () => {
    const { marks, more } = summariseMarks([
      of('🚀'),
      of('💯'),
      of('💯'),
      of('🤙'),
      of('🤙'),
      of('🤙'),
    ])
    expect(marks.map(m => m.display)).toEqual(['🤙', '💯', '🚀'])
    expect(more).toBe(0)
  })

  /** With arrival order the visible three would churn on every relay push. */
  it('breaks a tie toward the one sent more recently', () => {
    // Newest first, as the group holds them.
    const { marks } = summariseMarks([of('💯'), of('🤙')])
    expect(marks.map(m => m.display)).toEqual(['💯', '🤙'])
  })

  it('counts the DISTINCT marks it left out, not the people', () => {
    const { marks, more } = summariseMarks(
      ['🤙', '💯', '🚀', '👀', '😂', '🧡', '🫂'].map(e => of(e)),
    )
    expect(marks).toHaveLength(MAX_GROUP_MARKS)
    expect(more).toBe(4)
  })

  it('ignores the likes mixed in with them', () => {
    const { marks, more } = summariseMarks([of('+'), of('🤙'), of(''), of('-')])
    expect(marks.map(m => m.display)).toEqual(['🤙'])
    expect(more).toBe(0)
  })

  it('carries a custom emoji alongside a unicode one', () => {
    const { marks } = summariseMarks([
      of(':pepe:', [['emoji', 'pepe', 'https://cdn.example/pepe.png']]),
      of('🤙'),
    ])
    expect(marks).toEqual([
      { display: ':pepe:', url: 'https://cdn.example/pepe.png' },
      { display: '🤙' },
    ])
  })
})

describe('reactionVerb', () => {
  it('words each flavour once, for every surface that says it', () => {
    expect(reactionVerb('like')).toEqual({ before: 'liked your note', after: '' })
    expect(reactionVerb('dislike')).toEqual({ before: 'disliked your note', after: '' })
    // The marks go BETWEEN the two halves: "alice reacted 🤙 to your note".
    expect(reactionVerb('emoji')).toEqual({ before: 'reacted', after: 'to your note' })
  })
})
