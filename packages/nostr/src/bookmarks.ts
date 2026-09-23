/** NIP-51 bookmark list (kind 10003). */

import { BookmarkList as BookmarkListKind } from 'nostr-tools/kinds'

import { getTag, nowSeconds } from './events'
import type { EventTemplate, Hex, NostrEvent } from './types'

export const BOOKMARK_LIST_KIND = BookmarkListKind

/** Ceiling on a single list. */
export const MAX_BOOKMARKS = 1_000

/** One saved thing. `value` is a hex id, an `a` address, a hashtag or a URL. */
export interface Bookmark {
  type: 'e' | 'a' | 't' | 'r'
  value: string
}

export interface BookmarkList {
  /** Public items, in the order the tags appeared. */
  publicItems: Bookmark[]
  /** Items recovered from the encrypted content, in their own order. */
  privateItems: Bookmark[]
}

export const EMPTY_BOOKMARKS: BookmarkList = { publicItems: [], privateItems: [] }

const TYPES = new Set(['e', 'a', 't', 'r'])

function isBookmarkType(value: string): value is Bookmark['type'] {
  return TYPES.has(value)
}

/** Tags to bookmarks, dropping anything that is not one of the four. */
export function parseBookmarkTags(tags: readonly (readonly string[])[]): Bookmark[] {
  const out: Bookmark[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const [name, value] = tag
    if (name === undefined || value === undefined || value === '') continue
    if (!isBookmarkType(name)) continue
    // Hashtags are compared lowercase everywhere in this codebase.
    const normalized = name === 't' ? value.toLowerCase() : value
    const key = `${name}:${normalized}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type: name, value: normalized })
    if (out.length >= MAX_BOOKMARKS) break
  }
  return out
}

/** The public half of a list. */
export function parseBookmarks(event: NostrEvent): Bookmark[] {
  if (event.kind !== BOOKMARK_LIST_KIND) return []
  return parseBookmarkTags(event.tags)
}

/** Decrypted `content` to bookmarks. */
export function parsePrivateBookmarks(plaintext: string): Bookmark[] {
  if (plaintext.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(plaintext)
    if (!Array.isArray(parsed)) return []
    const tags = parsed.filter(
      (tag): tag is string[] => Array.isArray(tag) && tag.every(part => typeof part === 'string'),
    )
    return parseBookmarkTags(tags)
  } catch {
    return []
  }
}

export function bookmarkKey(bookmark: Bookmark): string {
  return `${bookmark.type}:${bookmark.value}`
}

/** Every saved item as `type:value`, both halves, for O(1) "is this bookmarked" checks. */
export function bookmarkKeys(list: BookmarkList): Set<string> {
  const keys = new Set<string>()
  for (const item of list.publicItems) keys.add(bookmarkKey(item))
  for (const item of list.privateItems) keys.add(bookmarkKey(item))
  return keys
}

export function hasBookmark(list: BookmarkList, bookmark: Bookmark): boolean {
  const key = bookmarkKey(bookmark)
  return (
    list.publicItems.some(item => bookmarkKey(item) === key) ||
    list.privateItems.some(item => bookmarkKey(item) === key)
  )
}

/** Add or remove one item, returning a new list. */
export function toggleBookmark(
  list: BookmarkList,
  bookmark: Bookmark,
  preferPrivate: boolean,
): BookmarkList {
  const key = bookmarkKey(bookmark)
  if (hasBookmark(list, bookmark)) {
    return {
      publicItems: list.publicItems.filter(item => bookmarkKey(item) !== key),
      privateItems: list.privateItems.filter(item => bookmarkKey(item) !== key),
    }
  }
  const entry: Bookmark = {
    type: bookmark.type,
    value: bookmark.type === 't' ? bookmark.value.toLowerCase() : bookmark.value,
  }
  if (preferPrivate) {
    return { publicItems: list.publicItems, privateItems: [entry, ...list.privateItems] }
  }
  return { publicItems: [entry, ...list.publicItems], privateItems: list.privateItems }
}

export function toBookmarkTags(items: readonly Bookmark[]): string[][] {
  return items.map(item => [item.type, item.value])
}

/** The event to publish. */
export function buildBookmarkList({
  items,
  encryptedContent = '',
  previous,
  createdAt = nowSeconds(),
}: {
  items: readonly Bookmark[]
  encryptedContent?: string
  previous?: NostrEvent
  createdAt?: number
}): EventTemplate {
  const carried = (previous?.tags ?? []).filter(tag => {
    const name = tag[0]
    return name === undefined || !isBookmarkType(name)
  })

  return {
    kind: BOOKMARK_LIST_KIND,
    // A replaceable event only wins if it is newer.
    created_at: Math.max(createdAt, (previous?.created_at ?? 0) + 1),
    tags: [...toBookmarkTags(items.slice(0, MAX_BOOKMARKS)), ...carried.map(tag => [...tag])],
    content: encryptedContent,
  }
}

/** Plaintext for the private half: a JSON tag array, ready to encrypt to the author's. */
export function privateBookmarksPlaintext(items: readonly Bookmark[]): string {
  return JSON.stringify(toBookmarkTags(items.slice(0, MAX_BOOKMARKS)))
}

/** NIP-01 replaceable tie-break: newest wins, and the lower id wins a tie on the second. */
export function newestBookmarkList(events: readonly NostrEvent[]): NostrEvent | undefined {
  let best: NostrEvent | undefined
  for (const event of events) {
    if (event.kind !== BOOKMARK_LIST_KIND) continue
    if (best === undefined || event.created_at > best.created_at) {
      best = event
      continue
    }
    if (event.created_at === best.created_at && event.id < best.id) best = event
  }
  return best
}

/** How to save one event: by id, or by address when the kind is addressable. */
export function bookmarkForEvent(event: NostrEvent): Bookmark {
  if (event.kind >= 30_000 && event.kind < 40_000) {
    return {
      type: 'a',
      value: articleAddress(event.kind, event.pubkey, getTag(event, 'd')?.[1] ?? ''),
    }
  }
  return { type: 'e', value: event.id }
}

/** `kind:pubkey:d`, the NIP-01 coordinate an `a` tag holds. */
export function articleAddress(kind: number, pubkey: Hex, identifier: string): string {
  return `${kind}:${pubkey}:${identifier}`
}
