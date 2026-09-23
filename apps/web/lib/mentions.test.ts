import { describe, expect, it } from 'vitest'

import { applyMentions, mentionRanges } from './mentions'

/** Turning the `@Name` a reader sees into the `nostr:npub…` a relay receives. */

const NOSTRICH = 'f27341f6cf1e7abdf894372246332f58fe79c9925d489fe597218017314adfd3'
const NPUB = 'nostr:npub17fe5rak0reatm7y5xu3yvve0trl8njvjt4yflevhyxqpwv22mlfs3wnzuc'
const ALICE = 'aa'.repeat(32)

const map = (entries: [string, string][]): Map<string, `${string}`> => new Map(entries) as never

describe('mentionRanges', () => {
  it('finds a token at the start of a draft and mid-sentence', () => {
    expect(mentionRanges('@nostrich ships', ['@nostrich'])[0]).toMatchObject({ start: 0, end: 9 })
    expect(mentionRanges('try @nostrich now', ['@nostrich'])[0]).toMatchObject({ start: 4, end: 13 })
  })

  it('does not find a token inside an email address', () => {
    // The failure that made this a boundary matcher: "hi@nostrich.org" published.
    expect(mentionRanges('mail hi@nostrich.org please', ['@nostrich'])).toEqual([])
  })

  it('does not find a short token inside a longer handle', () => {
    expect(mentionRanges('ask @nostrichdev about it', ['@nostrich'])).toEqual([])
  })

  it('prefers the longest token where two could match', () => {
    const found = mentionRanges('hey @anna', ['@ann', '@anna'])
    expect(found).toHaveLength(1)
    expect(found[0]?.token).toBe('@anna')
  })

  it('finds every occurrence of the same token', () => {
    expect(mentionRanges('@nostrich and @nostrich', ['@nostrich'])).toHaveLength(2)
  })

  it('matches a token that ends the draft, with no trailing character', () => {
    expect(mentionRanges('thanks @nostrich', ['@nostrich'])).toHaveLength(1)
  })

  it('allows a name with a space in it', () => {
    expect(mentionRanges('cc @Jack Dorsey said so', ['@Jack Dorsey'])).toHaveLength(1)
  })

  it('is case-sensitive, because the token is what the picker inserted', () => {
    // Silently mentioning a different account because the case drifted would be worse.
    expect(mentionRanges('try @Nostrich', ['@nostrich'])).toEqual([])
  })

  it('ignores punctuation directly after the name', () => {
    expect(mentionRanges('thanks @nostrich!', ['@nostrich'])).toHaveLength(1)
    expect(mentionRanges('(@nostrich)', ['@nostrich'])).toHaveLength(1)
  })
})

describe('applyMentions', () => {
  it('writes the pointer a relay understands', () => {
    expect(applyMentions('try @nostrich now', map([['@nostrich', NOSTRICH]]))).toBe(
      `try ${NPUB} now`,
    )
  })

  it('leaves an email address alone', () => {
    const text = 'write to hi@nostrich.org'
    expect(applyMentions(text, map([['@nostrich', NOSTRICH]]))).toBe(text)
  })

  it('leaves a draft with no remembered tokens byte-for-byte', () => {
    const text = 'try https://nostrich.org works pretty well with clave'
    expect(applyMentions(text, map([['@nostrich', NOSTRICH]]))).toBe(text)
  })

  it('replaces two different people in one sentence', () => {
    const out = applyMentions('@nostrich and @alice', map([['@nostrich', NOSTRICH], ['@alice', ALICE]]))
    expect(out.startsWith(NPUB)).toBe(true)
    expect(out).toContain('nostr:npub1')
    expect(out).not.toContain('@')
  })
})

describe('a token inside a URL is not a mention', () => {
  it('leaves a link containing the token alone', () => {
    // Found by review: the composer refused to paint this (the link range wins).
    const text = 'see https://x.com/@nostrich for the thread'
    expect(mentionRanges(text, ['@nostrich'])).toEqual([])
    expect(applyMentions(text, map([['@nostrich', NOSTRICH]]))).toBe(text)
  })

  it('still finds a real mention in the same sentence', () => {
    const text = 'see https://x.com/@nostrich and @nostrich too'
    expect(mentionRanges(text, ['@nostrich'])).toHaveLength(1)
  })
})
