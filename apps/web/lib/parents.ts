'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Hex, NostrEvent } from '@nostrich/nostr'

import { getCachedEvent, rememberEvents } from './event-cache'
import { isDeleted } from './deleted'
import { getPool } from './pool'
import { parentOf } from './thread'

/** Parent ids already asked for and not found, for the lifetime of the tab. */
const attempted = new Set<Hex>()

/** The note each reply is answering, for a list of replies. */
export function useParents(replies: readonly NostrEvent[]): Map<Hex, NostrEvent> {
  const [fetched, setFetched] = useState<Map<Hex, NostrEvent>>(() => new Map())

  /** Reply id → parent id, for the replies that name one. */
  const wanted = useMemo(() => {
    const map = new Map<Hex, Hex>()
    for (const reply of replies) {
      const parent = parentOf(reply)
      // A deleted parent stays deleted: the cache outlives the relays dropping.
      if (parent !== undefined && !isDeleted(parent)) map.set(reply.id, parent)
    }
    return map
  }, [replies])

  const missingKey = useMemo(() => {
    const missing = new Set<Hex>()
    for (const parent of wanted.values()) {
      if (getCachedEvent(parent) !== undefined || fetched.has(parent)) continue
      if (attempted.has(parent)) continue
      missing.add(parent)
    }
    // A stable string, so the effect below runs when the SET of missing ids changes.
    return [...missing].sort().join(',')
  }, [wanted, fetched])

  useEffect(() => {
    if (missingKey === '') return
    const ids = missingKey.split(',') as Hex[]
    let cancelled = false
    void (async () => {
      const found = await getPool().query([{ ids }], undefined, 6_000)
      if (cancelled) return
      rememberEvents(found)
      setFetched(current => {
        const next = new Map(current)
        for (const event of found) next.set(event.id, event)
        // An id that resolved to nothing never gains an entry here, so `attempted`.
        for (const id of ids) if (!next.has(id)) attempted.add(id)
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [missingKey])

  return useMemo(() => {
    const map = new Map<Hex, NostrEvent>()
    for (const [replyId, parentId] of wanted) {
      const parent = getCachedEvent(parentId) ?? fetched.get(parentId)
      if (parent !== undefined) map.set(replyId, parent)
    }
    return map
  }, [wanted, fetched])
}
