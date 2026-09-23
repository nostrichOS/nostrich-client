'use client'

import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  isCiphertext,
  BOOKMARK_LIST_KIND,
  DEFAULT_INDEXER_RELAYS,
  DEFAULT_RELAYS,
  bookmarkKey,
  bookmarkKeys,
  buildBookmarkList,
  newestBookmarkList,
  normalizeRelayUrls,
  parseBookmarks,
  parsePrivateBookmarks,
  privateBookmarksPlaintext,
  toggleBookmark,
  type Bookmark,
  type BookmarkList,
  type Hex,
  type NostrEvent,
  type RelayUrl,
  type Signer,
} from '@nostrich/nostr'

import { getCachedEvent, rememberEvents } from './event-cache'
import { bookmarksArePublic } from './bookmark-privacy'
import { getPool } from './pool'
import { sessionPubkey, useSession } from '../components/SessionProvider'

/** The reader's bookmark list, read from relays and written back on every change. */

/** Same relay set as contact lists, for the same reason. */
const BOOKMARK_RELAYS: RelayUrl[] = normalizeRelayUrls([
  'wss://purplepag.es',
  ...DEFAULT_INDEXER_RELAYS,
  ...DEFAULT_RELAYS,
])

const QUERY_TIMEOUT_MS = 6_000

export interface BookmarksSnapshot {
  list: BookmarkList
  /** The event this replaces, so unknown tags on it survive the next save. */
  event: NostrEvent | undefined
  /** Whether new bookmarks can go in the encrypted half. */
  canEncrypt: boolean
}

const EMPTY: BookmarksSnapshot = {
  list: { publicItems: [], privateItems: [] },
  event: undefined,
  canEncrypt: true,
}

function queryKey(pubkey: string): string[] {
  return ['bookmarks', pubkey]
}

/** Whether this signer can actually encrypt. */
async function probeEncryption(signer: Signer, pubkey: Hex): Promise<boolean> {
  try {
    return isCiphertext(await signer.nip44Encrypt(pubkey, 'probe'))
  } catch {
    return false
  }
}

async function loadBookmarks(pubkey: Hex, signer: Signer): Promise<BookmarksSnapshot> {
  /** THE RELAY AND THE SIGNER ARE ASKED AT THE SAME TIME, because neither needs the other. */
  const [events, canEncrypt] = await Promise.all([
    getPool().query(
      [{ kinds: [BOOKMARK_LIST_KIND], authors: [pubkey], limit: 1 }],
      BOOKMARK_RELAYS,
      QUERY_TIMEOUT_MS,
    ),
    probeEncryption(signer, pubkey),
  ])
  const event = newestBookmarkList(events)

  let privateItems: Bookmark[] = []
  if (event !== undefined && event.content.trim() !== '') {
    // NIP-44 first because that is what NIP-51 specifies now, then NIP-04, because lists.
    try {
      privateItems = parsePrivateBookmarks(await signer.nip44Decrypt(pubkey, event.content))
    } catch {
      try {
        const legacy = await signer.nip04Decrypt?.(pubkey, event.content)
        if (legacy !== undefined) privateItems = parsePrivateBookmarks(legacy)
      } catch {
        // Unreadable.
      }
    }
  }

  return {
    list: { publicItems: event === undefined ? [] : parseBookmarks(event), privateItems },
    event,
    canEncrypt,
  }
}

export interface BookmarksResult {
  /** `type:value` for every saved item, both halves. */
  keys: Set<string>
  items: Bookmark[]
  loading: boolean
  saving: boolean
  /** True when new bookmarks are encrypted. */
  isPrivate: boolean
  /** Signed out, or the last save was refused by every relay. */
  error: 'signed-out' | 'publish' | undefined
  toggle: (bookmark: Bookmark) => void
  has: (bookmark: Bookmark) => boolean
  /** How many saved items are currently in the encrypted half. */
  privateCount: number
  /** Move every encrypted bookmark into the public half. */
  publishExisting: () => void
  publishingExisting: boolean
}

export function useBookmarks(): BookmarksResult {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const signer = session.status === 'signed' ? session.signer : undefined
  const enabled = pubkey !== undefined && signer !== undefined
  const key = pubkey ?? ''
  const client = useQueryClient()

  const query = useQuery({
    queryKey: queryKey(key),
    queryFn: async (): Promise<BookmarksSnapshot> => {
      if (pubkey === undefined || signer === undefined) return EMPTY
      return loadBookmarks(pubkey, signer)
    },
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  const snapshot = query.data ?? EMPTY

  /** One save at a time. */
  const mutation = useMutation({
    mutationKey: queryKey(key),
    scope: { id: `bookmarks:${key}` },
    mutationFn: async (bookmark: Bookmark): Promise<void> => {
      if (pubkey === undefined || signer === undefined) return

      /** The toggle happens ONCE, here, and the optimistic write is part. */
      const current = client.getQueryData<BookmarksSnapshot>(queryKey(key)) ?? EMPTY
      /** Public unless the reader asked for private AND the signer can actually encrypt. */
      const preferPrivate = !bookmarksArePublic() && current.canEncrypt
      const next = toggleBookmark(current.list, bookmark, preferPrivate)

      // Optimistic: the icon fills or empties on click.
      client.setQueryData<BookmarksSnapshot>(queryKey(key), { ...current, list: next })

      try {
        const content =
          next.privateItems.length === 0
            ? ''
            : await signer.nip44Encrypt(pubkey, privateBookmarksPlaintext(next.privateItems))

        /** Refuse to publish a list that lost its private half on the way out. */
        if (next.privateItems.length > 0 && !isCiphertext(content)) {
          throw new Error('the signer could not encrypt your private bookmarks')
        }

        const template = buildBookmarkList({
          items: next.publicItems,
          encryptedContent: content,
          previous: current.event,
        })
        const signed = await signer.signEvent(template)
        const results = await getPool().publish(signed)
        if (!results.some(result => result.ok)) {
          throw new Error('no relay accepted the bookmark list')
        }

        // The signed event becomes the new base: the next save has to carry its tags forward.
        client.setQueryData<BookmarksSnapshot>(queryKey(key), {
          list: next,
          event: signed,
          canEncrypt: current.canEncrypt,
        })
      } catch (error) {
        // Put it back.
        client.setQueryData<BookmarksSnapshot>(queryKey(key), current)
        throw error
      }
    },
  })

  const keys = useMemo(() => bookmarkKeys(snapshot.list), [snapshot.list])
  const items = useMemo(
    () => [...snapshot.list.privateItems, ...snapshot.list.publicItems],
    [snapshot.list],
  )

  const has = useCallback(
    (bookmark: Bookmark): boolean =>
      keys.has(`${bookmark.type}:${bookmark.type === 't' ? bookmark.value.toLowerCase() : bookmark.value}`),
    [keys],
  )

  const toggle = useCallback(
    (bookmark: Bookmark): void => {
      if (!enabled) return
      mutation.mutate(bookmark)
    },
    [enabled, mutation],
  )

  /** Move everything in the encrypted half into the public half, once, on request. */
  const migration = useMutation({
    mutationFn: async (): Promise<void> => {
      if (pubkey === undefined || signer === undefined) return
      const current = client.getQueryData<BookmarksSnapshot>(queryKey(key)) ?? EMPTY
      if (current.list.privateItems.length === 0) return

      const next: BookmarkList = {
        // Private ones first: they are the older saves, and the public half is prepended.
        publicItems: [...current.list.privateItems, ...current.list.publicItems],
        privateItems: [],
      }
      const template = buildBookmarkList({
        items: next.publicItems,
        // Nothing left to encrypt.
        encryptedContent: '',
        previous: current.event,
      })
      const signed = await signer.signEvent(template)
      const results = await getPool().publish(signed)
      if (!results.some(result => result.ok)) {
        throw new Error('no relay accepted the bookmark list')
      }
      client.setQueryData<BookmarksSnapshot>(queryKey(key), {
        list: next,
        event: signed,
        canEncrypt: current.canEncrypt,
      })
    },
  })

  return {
    keys,
    items,
    loading: query.isPending && enabled,
    saving: mutation.isPending,
    isPrivate: snapshot.canEncrypt,
    error: !enabled ? 'signed-out' : mutation.isError ? 'publish' : undefined,
    toggle,
    has,
    privateCount: snapshot.list.privateItems.length,
    publishExisting: () => {
      if (enabled) migration.mutate()
    },
    publishingExisting: migration.isPending,
  }
}

// ---------------------------------------------------------------------------.

/** Ids per filter. */
const ID_CHUNK = 200
const RESOLVE_TIMEOUT_MS = 8_000

/** `kind:pubkey:d`, as an `a` tag holds. */
function parseAddress(value: string): { kind: number; pubkey: Hex; identifier: string } | undefined {
  const [rawKind, pubkey, ...rest] = value.split(':')
  const kind = Number(rawKind)
  // The identifier may itself contain colons, so it is everything after the second one.
  const identifier = rest.join(':')
  if (!Number.isInteger(kind) || pubkey === undefined || pubkey.length !== 64) return undefined
  return { kind, pubkey, identifier }
}

/** The events behind the saved ids and addresses. */
export function useBookmarkedEvents(items: readonly Bookmark[]): {
  events: Map<string, NostrEvent>
  loading: boolean
} {
  const pointers = useMemo(
    (): string[] => items.filter(item => item.type === 'e' || item.type === 'a').map(bookmarkKey),
    [items],
  )
  // The array identity changes every render.
  const cacheKey = pointers.join(',')

  const query = useQuery({
    queryKey: ['bookmark-events', cacheKey],
    queryFn: async (): Promise<NostrEvent[]> => {
      const ids: Hex[] = []
      const addresses: string[] = []
      for (const pointer of pointers) {
        const value = pointer.slice(2)
        if (pointer.startsWith('e:')) ids.push(value)
        else addresses.push(value)
      }

      const filters: Parameters<ReturnType<typeof getPool>['query']>[0] = []
      for (let start = 0; start < ids.length; start += ID_CHUNK) {
        const chunk = ids.slice(start, start + ID_CHUNK)
        // `limit` matching the chunk, because a relay applies its own default to a filter.
        filters.push({ ids: chunk, limit: chunk.length })
      }

      // Addressable events are grouped into one filter per kind.
      const byKind = new Map<number, { authors: Set<Hex>; identifiers: Set<string> }>()
      for (const address of addresses) {
        const parsed = parseAddress(address)
        if (parsed === undefined) continue
        const group = byKind.get(parsed.kind) ?? { authors: new Set(), identifiers: new Set() }
        group.authors.add(parsed.pubkey)
        group.identifiers.add(parsed.identifier)
        byKind.set(parsed.kind, group)
      }
      for (const [kind, group] of byKind) {
        filters.push({
          kinds: [kind],
          authors: [...group.authors],
          '#d': [...group.identifiers],
        })
      }

      if (filters.length === 0) return []
      const events = await getPool().query(filters, undefined, RESOLVE_TIMEOUT_MS)
      // Opening a bookmarked note should not re-query.
      rememberEvents(events)
      return events
    },
    enabled: pointers.length > 0,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  const events = useMemo(() => {
    const map = new Map<string, NostrEvent>()
    const wanted = new Set(pointers)

    // The session cache first: notes scrolled past in the timeline are already in memory.
    for (const pointer of pointers) {
      if (!pointer.startsWith('e:')) continue
      const cached = getCachedEvent(pointer.slice(2))
      if (cached !== undefined) map.set(pointer, cached)
    }

    for (const event of query.data ?? []) {
      const byId = `e:${event.id}`
      if (wanted.has(byId)) {
        map.set(byId, event)
        continue
      }
      const identifier = event.tags.find(tag => tag[0] === 'd')?.[1] ?? ''
      const byAddress = `a:${event.kind}:${event.pubkey}:${identifier}`
      // Newest wins: an addressable event can come back in several versions, one per relay.
      const existing = map.get(byAddress)
      if (wanted.has(byAddress) && (existing === undefined || event.created_at > existing.created_at)) {
        map.set(byAddress, event)
      }
    }
    return map
  }, [pointers, query.data])

  return { events, loading: query.isPending && pointers.length > 0 }
}
