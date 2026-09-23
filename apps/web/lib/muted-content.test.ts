import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Hex, NostrEvent } from '@nostrich/nostr'

import { hideNsfw, isMutedContent, isNsfw, mutedFor, setHideNsfw } from './muted-content'
import { addTerm, normalizeTerm, removeTerm, termMembers } from './user-lists'
import { setActiveScope } from './scope'

/** The reader's own filters. */

const note = (over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: '0'.repeat(64),
    pubkey: '1'.repeat(64) as Hex,
    kind: 1,
    created_at: 1_700_000_000,
    content: '',
    tags: [],
    sig: '',
    ...over,
  }) as NostrEvent

beforeEach(() => {
  for (const term of termMembers('mutedWords')) removeTerm('mutedWords', term)
  for (const term of termMembers('mutedHashtags')) removeTerm('mutedHashtags', term)
  setHideNsfw(false)
})

/** THE READER IS NEVER FILTERED OUT OF THEIR OWN FEED. */
describe('the reader, against their own filters', () => {
  const ME = '1'.repeat(64) as Hex
  const THEM = '2'.repeat(64) as Hex

  beforeEach(() => setActiveScope(ME))
  afterEach(() => setActiveScope(undefined))

  it('does not filter the reader\'s own note on a muted word', () => {
    addTerm('mutedWords', 'airdrop')
    expect(mutedFor(note({ pubkey: ME, content: 'free airdrop today' }))).toBeUndefined()
    expect(isMutedContent(note({ pubkey: ME, content: 'free airdrop today' }))).toBe(false)
  })

  it('still filters somebody else on the same word, so the exemption is the reader alone', () => {
    addTerm('mutedWords', 'airdrop')
    expect(mutedFor(note({ pubkey: THEM, content: 'free airdrop today' }))).toEqual({
      kind: 'word',
      term: 'airdrop',
    })
  })

  it('does not filter the reader\'s own note on a muted hashtag', () => {
    addTerm('mutedHashtags', 'politics')
    expect(mutedFor(note({ pubkey: ME, tags: [['t', 'politics']] }))).toBeUndefined()
  })

  it('does not filter the reader\'s own note behind the adult switch', () => {
    setHideNsfw(true)
    expect(mutedFor(note({ pubkey: ME, tags: [['t', 'nsfw']] }))).toBeUndefined()
  })
})

describe('normalizeTerm', () => {
  it('strips the hash and the case, so one subject is one entry', () => {
    // Relays index the lowercase bare form, and `mute-list` normalises the same way.
    expect(normalizeTerm('#Bitcoin')).toBe('bitcoin')
    expect(normalizeTerm('  ##NOSTR  ')).toBe('nostr')
  })
})

describe('muted words', () => {
  it('matches a whole word', () => {
    addTerm('mutedWords', 'airdrop')
    expect(mutedFor(note({ content: 'free airdrop today' }))).toEqual({ kind: 'word', term: 'airdrop' })
  })

  it('does NOT match inside a longer word', () => {
    // Mute "art" and lose "start" is the classic word-filter failure.
    addTerm('mutedWords', 'art')
    expect(isMutedContent(note({ content: 'just getting started' }))).toBe(false)
    expect(isMutedContent(note({ content: 'a piece of art' }))).toBe(true)
  })

  it('matches a multi-word phrase', () => {
    addTerm('mutedWords', 'not financial advice')
    expect(isMutedContent(note({ content: 'obviously this is not financial advice, ok?' }))).toBe(true)
  })

  it('ignores case', () => {
    addTerm('mutedWords', 'airdrop')
    expect(isMutedContent(note({ content: 'FREE AIRDROP' }))).toBe(true)
  })

  it('works outside ASCII, where a word boundary would have failed', () => {
    // `\b` is defined on ASCII word characters: it fires in the middle of accented text.
    addTerm('mutedWords', 'kripto')
    expect(isMutedContent(note({ content: 'kripto para' }))).toBe(true)
    expect(isMutedContent(note({ content: 'kriptoyla ilgili' }))).toBe(false)
  })

  it('reads hashtags as text too', () => {
    // Somebody muting "airdrop" means the word wherever it appears, and a note carrying.
    addTerm('mutedWords', 'airdrop')
    expect(isMutedContent(note({ tags: [['t', 'airdrop']] }))).toBe(true)
  })

  it('does not throw on an event with no body', () => {
    // The account switcher's watch carries a deliberately narrow event with no content.
    addTerm('mutedWords', 'airdrop')
    expect(() => isMutedContent({ ...note(), content: undefined } as unknown as NostrEvent)).not.toThrow()
  })
})

describe('muted hashtags', () => {
  it('matches the tag', () => {
    addTerm('mutedHashtags', '#Politics')
    expect(mutedFor(note({ tags: [['t', 'politics']] }))).toEqual({ kind: 'hashtag', term: 'politics' })
  })

  it('matches the word written into the body by a client that did not tag it', () => {
    addTerm('mutedHashtags', 'politics')
    expect(isMutedContent(note({ content: 'thoughts on #politics today' }))).toBe(true)
  })

  it('leaves an untagged note alone', () => {
    addTerm('mutedHashtags', 'politics')
    expect(isMutedContent(note({ content: 'thoughts on the weather' }))).toBe(false)
  })
})

describe('the adult switch', () => {
  it('is off by default, so nothing disappears because a filter shipped', () => {
    expect(hideNsfw()).toBe(false)
    expect(isMutedContent(note({ tags: [['t', 'nsfw']] }))).toBe(false)
  })

  it('hides a note its own author tagged, once turned on', () => {
    setHideNsfw(true)
    expect(mutedFor(note({ tags: [['t', 'nsfw']] }))).toEqual({ kind: 'nsfw' })
    expect(isMutedContent(note({ tags: [['t', 'XXX']] }))).toBe(true)
  })

  it('honours NIP-36 content-warning, the protocol tag written for exactly this', () => {
    setHideNsfw(true)
    expect(isNsfw(note({ tags: [['content-warning', 'nudity']] }))).toBe(true)
  })

  it('leaves an ordinary note alone', () => {
    setHideNsfw(true)
    expect(isMutedContent(note({ content: 'good morning', tags: [['t', 'coffee']] }))).toBe(false)
  })
})
