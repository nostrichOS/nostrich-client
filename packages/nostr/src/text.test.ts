import { describe, expect, it } from 'vitest'

import { graphemes, truncateGraphemes } from './text'

/** A lone surrogate is what a naive `slice` leaves behind, and it renders. */
function hasLoneSurrogate(text: string): boolean {
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(at + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      at += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

describe('graphemes', () => {
  it('counts what a reader would call characters', () => {
    expect(graphemes('')).toEqual([])
    expect(graphemes('abc')).toHaveLength(3)
    // A family is seven code points and one character.
    expect(graphemes('👨‍👩‍👧‍👦')).toHaveLength(1)
    expect(graphemes('👨‍👩‍👧‍👦👍')).toHaveLength(2)
    // Two regional indicators per flag.
    expect(graphemes('🇯🇵🇺🇸')).toHaveLength(2)
    // Skin tone is a modifier, not a second character.
    expect(graphemes('🤙🏽')).toHaveLength(1)
  })
})

describe('truncateGraphemes', () => {
  it('leaves anything already short enough alone', () => {
    expect(truncateGraphemes('gm', 8)).toBe('gm')
    expect(truncateGraphemes('🤙', 1)).toBe('🤙')
  })

  it('counts the ellipsis inside the budget', () => {
    expect(truncateGraphemes('abcdef', 3)).toBe('ab…')
    expect(truncateGraphemes('abc', 1)).toBe('…')
  })

  it('never splits a character in half', () => {
    for (const text of ['👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦', '🇯🇵🇺🇸🇬🇧', '🤙🏽🤙🏽🤙🏽']) {
      const cut = truncateGraphemes(text, 2)
      expect(hasLoneSurrogate(cut)).toBe(false)
    }
  })

  it('returns nothing for a budget of nothing', () => {
    expect(truncateGraphemes('anything', 0)).toBe('')
  })
})
