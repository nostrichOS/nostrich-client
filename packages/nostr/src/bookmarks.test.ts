import { describe, expect, it } from 'vitest'

import {
  buildBookmarkList,
  hasBookmark,
  newestBookmarkList,
  parseBookmarks,
  parsePrivateBookmarks,
  privateBookmarksPlaintext,
  toggleBookmark,
  type BookmarkList,
} from './bookmarks'
import type { NostrEvent } from './types'

/** A bookmark list is replaceable, so every one of these guards the same failure. */

const NOTE = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

function list(tags: string[][], createdAt = 1_783_000_000, id = '0'.repeat(64)): NostrEvent {
  return {
    id,
    pubkey: 'c'.repeat(64),
    created_at: createdAt,
    kind: 10003,
    tags,
    content: '',
    sig: '0'.repeat(128),
  }
}

describe('parseBookmarks', () => {
  it('keeps notes, articles, hashtags and links', () => {
    const parsed = parseBookmarks(
      list([
        ['e', NOTE],
        ['a', `30023:${OTHER}:my-article`],
        ['t', 'Bitcoin'],
        ['r', 'https://example.com'],
      ]),
    )
    expect(parsed.map(item => item.type)).toEqual(['e', 'a', 't', 'r'])
    // Hashtags are matched lowercase everywhere else, so #Bitcoin and #bitcoin are one.
    expect(parsed[2]?.value).toBe('bitcoin')
  })

  it('ignores tags that are not bookmarks and drops duplicates', () => {
    const parsed = parseBookmarks(
      list([
        ['alt', 'a bookmark list'],
        ['e', NOTE],
        ['e', NOTE],
        ['p', OTHER],
      ]),
    )
    expect(parsed).toHaveLength(1)
  })

  it('reads the private half from decrypted content', () => {
    expect(parsePrivateBookmarks(JSON.stringify([['e', NOTE]]))).toHaveLength(1)
  })

  it('returns empty rather than throwing when the private half is unreadable', () => {
    // Failed decryption must not blank the page.
    expect(parsePrivateBookmarks('not json')).toEqual([])
    expect(parsePrivateBookmarks('{"e":"nope"}')).toEqual([])
  })
})

describe('toggleBookmark', () => {
  const empty: BookmarkList = { publicItems: [], privateItems: [] }

  it('adds new items privately and puts them first', () => {
    const one = toggleBookmark(empty, { type: 'e', value: NOTE }, true)
    const two = toggleBookmark(one, { type: 'e', value: OTHER }, true)
    expect(two.publicItems).toEqual([])
    expect(two.privateItems.map(item => item.value)).toEqual([OTHER, NOTE])
  })

  it('adds publicly when the signer cannot encrypt', () => {
    const next = toggleBookmark(empty, { type: 'e', value: NOTE }, false)
    expect(next.publicItems).toHaveLength(1)
    expect(next.privateItems).toEqual([])
  })

  it('never moves an existing public bookmark into ciphertext', () => {
    const seeded: BookmarkList = { publicItems: [{ type: 'e', value: NOTE }], privateItems: [] }
    const next = toggleBookmark(seeded, { type: 'e', value: OTHER }, true)
    expect(next.publicItems.map(item => item.value)).toEqual([NOTE])
    expect(next.privateItems.map(item => item.value)).toEqual([OTHER])
  })

  it('removes from whichever half holds it', () => {
    const seeded: BookmarkList = {
      publicItems: [{ type: 'e', value: NOTE }],
      privateItems: [{ type: 'e', value: OTHER }],
    }
    expect(hasBookmark(toggleBookmark(seeded, { type: 'e', value: NOTE }, true), { type: 'e', value: NOTE })).toBe(false)
    expect(
      hasBookmark(toggleBookmark(seeded, { type: 'e', value: OTHER }, true), { type: 'e', value: OTHER }),
    ).toBe(false)
  })
})

describe('buildBookmarkList', () => {
  it('carries forward tags it does not understand', () => {
    // Losing an `alt` or a title on every save is indistinguishable from deleting.
    const previous = list([['e', NOTE], ['alt', 'my bookmarks']])
    const built = buildBookmarkList({ items: [{ type: 'e', value: OTHER }], previous })
    expect(built.tags).toContainEqual(['alt', 'my bookmarks'])
    expect(built.tags).toContainEqual(['e', OTHER])
    expect(built.tags).not.toContainEqual(['e', NOTE])
  })

  it('is always newer than the event it replaces', () => {
    // Same-second republish leaves relays free to keep either copy, so a save can revert.
    const previous = list([], 1_900_000_000)
    const built = buildBookmarkList({ items: [], previous, createdAt: 1_783_000_000 })
    expect(built.created_at).toBeGreaterThan(previous.created_at)
  })

  it('round-trips the private half through its plaintext form', () => {
    const items = [{ type: 'e' as const, value: NOTE }]
    expect(parsePrivateBookmarks(privateBookmarksPlaintext(items))).toEqual(items)
  })
})

describe('newestBookmarkList', () => {
  it('prefers the newest copy and breaks a tie on the lower id', () => {
    const older = list([['e', NOTE]], 100, '1'.repeat(64))
    const newer = list([['e', OTHER]], 200, '9'.repeat(64))
    expect(newestBookmarkList([older, newer])).toBe(newer)

    const tieHigh = list([], 300, 'f'.repeat(64))
    const tieLow = list([], 300, '0'.repeat(64))
    expect(newestBookmarkList([tieHigh, tieLow])).toBe(tieLow)
  })
})
