import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import {
  EMPTY_SEARCH,
  fromSearchParams,
  toSearchParams,
} from '../components/AdvancedSearch'
import { buildFilters, matches, parseSearch, terms, type SearchInput } from './search'

const NOW = 1_800_000_000
const NPUB = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6'
const HEX = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'

function input(patch: Partial<SearchInput> = {}): SearchInput {
  return { include: '', from: '', to: '', zappedBy: '', since: '', ...patch }
}

function note(content: string, patch: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: NOW,
    kind: 1,
    tags: [],
    content,
    sig: '0'.repeat(128),
    ...patch,
  }
}

/** The one rule this file exists to enforce. */
describe('search filters', () => {
  it('never puts `search` on the filter meant for ordinary relays', () => {
    const built = buildFilters(parseSearch(input({ include: 'bitcoin mining' }), NOW), {})
    expect(built.fallback).toBeDefined()
    expect(built.fallback).not.toHaveProperty('search')
    expect(built.index).toHaveProperty('search', 'bitcoin mining')
  })

  it('builds no index track when there is no text to search for', () => {
    const built = buildFilters(parseSearch(input({ from: NPUB }), NOW), {})
    expect(built.index).toBeUndefined()
    expect(built.fallback?.authors).toEqual([HEX])
  })

  it('asks the ordinary relays by tag when the query is a bare hashtag', () => {
    const built = buildFilters(parseSearch(input({ include: '#bitcoin' }), NOW), {})
    // Native on every relay, NIP-50.
    expect(built.fallback?.['#t']).toEqual(['bitcoin'])
    // An index searches text.
    expect(built.index).not.toHaveProperty('#t')
  })

  it('carries each track its own cursor', () => {
    const parsed = parseSearch(input({ include: 'nostr' }), NOW)
    const built = buildFilters(parsed, { index: 1_000, fallback: 2_000 })
    expect(built.index?.until).toBe(1_000)
    expect(built.fallback?.until).toBe(2_000)
  })

  it('turns "zapped by" into a receipt query that replaces the text tracks', () => {
    const built = buildFilters(parseSearch(input({ include: 'gm', zappedBy: NPUB }), NOW), {})
    expect(built.zaps).toMatchObject({ kinds: [9735], '#P': [HEX] })
    // The candidates are whatever that person zapped.
    expect(built.index).toBeUndefined()
    expect(built.fallback).toBeUndefined()
  })

  it('reads "replying to" as a person or as a note', () => {
    expect(buildFilters(parseSearch(input({ to: NPUB }), NOW), {}).fallback?.['#p']).toEqual([HEX])
    const noteId = 'b'.repeat(64)
    expect(buildFilters(parseSearch(input({ to: noteId }), NOW), {}).fallback?.['#e']).toEqual([
      noteId,
    ])
  })

  it('refuses to build anything from an empty query', () => {
    expect(buildFilters(parseSearch(input(), NOW), {})).toEqual({})
  })

  it('explains a bad author rather than searching for it as text', () => {
    expect(parseSearch(input({ from: 'not-a-key' }), NOW).error).toBe(
      'That is not an npub or nprofile.',
    )
    expect(parseSearch(input({ from: 'me@example.com' }), NOW).error).toContain('NIP-05')
  })
})

/** The local pass, which runs over every track whatever the relay claimed to have done. */
describe('matches', () => {
  const parsed = parseSearch(input({ include: 'bitcoin mining' }), NOW)

  it('requires every term', () => {
    expect(matches(note('bitcoin mining is loud'), parsed)).toBe(true)
    expect(matches(note('bitcoin is loud'), parsed)).toBe(false)
  })

  it('accepts a tagged note on a hashtag query without needing the word in the text', () => {
    const tag = parseSearch(input({ include: '#nostr' }), NOW)
    expect(matches(note('no mention of it', { tags: [['t', 'Nostr']] }), tag)).toBe(true)
  })

  it('holds "replying to a person" to actual replies, not mentions', () => {
    const to = parseSearch(input({ to: NPUB }), NOW)
    const mention = note('hello there', { tags: [['p', HEX]] })
    const reply = note('hello there', {
      tags: [
        ['e', 'f'.repeat(64), '', 'root'],
        ['p', HEX],
      ],
    })
    expect(matches(mention, to)).toBe(false)
    expect(matches(reply, to)).toBe(true)
  })

  it('drops anything older than the window even when a relay ignored `since`', () => {
    const recent = parseSearch(input({ include: 'gm', since: '1h' }), NOW)
    expect(matches(note('gm', { created_at: NOW - 30 * 60 }), recent)).toBe(true)
    expect(matches(note('gm', { created_at: NOW - 5 * 3_600 }), recent)).toBe(false)
  })
})

describe('terms', () => {
  it('drops one leading @, which is punctuation rather than part of a name', () => {
    expect(terms('@nostrich')).toEqual(['nostrich'])
    expect(terms('  Bitcoin   Mining ')).toEqual(['bitcoin', 'mining'])
    expect(terms('   ')).toEqual([])
  })
})

/** The URL contract. */
describe('search params round trip', () => {
  it('keeps a full query through both directions', () => {
    const query = {
      include: 'bitcoin mining',
      kind: 'notes' as const,
      postedBy: NPUB,
      repliesTo: '',
      zappedBy: '',
      since: '24h' as const,
      sort: 'relevance' as const,
    }
    const back = fromSearchParams(new URLSearchParams(toSearchParams(query)))
    expect(back).toEqual(query)
  })

  it('writes nothing for the defaults, so a simple search stays a readable URL', () => {
    expect(toSearchParams({ ...EMPTY_SEARCH, include: 'gm' })).toBe('q=gm')
  })

  /** Links written before the control moved still work. */
  it('reads the retired `order=engagement` as the Top sort', () => {
    expect(fromSearchParams(new URLSearchParams('q=gm&order=engagement')).sort).toBe('top')
  })

  it('falls back rather than trusting an unknown value', () => {
    expect(fromSearchParams(new URLSearchParams('sort=nonsense&since=forever')).sort).toBe('recent')
    expect(fromSearchParams(new URLSearchParams('since=forever')).since).toBe('')
  })
})
