'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  isPrivateUrl,
  isReply,
  KINDS,
  buildThreadTree,
  getThreadRoot,
  type Hex,
  type NostrEvent,
  type RelayUrl,
  type ThreadNode,
} from '@nostrich/nostr'

import { getCachedEvent, rememberEvent, rememberEvents } from './event-cache'
import { getPool } from './pool'
import { onPublished, onRetracted } from './published'

export interface ThreadApi {
  /** The note the URL asked for. Undefined until it is found, or if it never. */
  target: NostrEvent | undefined
  /** Ancestors, oldest first, ending at the target's direct parent. */
  ancestors: NostrEvent[]
  /** Replies below the target, as a tree. */
  replies: ThreadNode[]
  loading: boolean
  /** True once the fetch settled without ever finding the target. */
  missing: boolean
}

/** Load a note, everything above it, and everything below. */
/** The kinds an answer can arrive. */
const REPLY_KINDS: number[] = [KINDS.shortNote, KINDS.comment]

/** Our relays, the link's hints, and the author's own. */
function relaysFor(hints: readonly RelayUrl[], author: Hex | undefined): RelayUrl[] | undefined {
  const mine = getPool().readRelays()
  const extra = [
    ...hints.filter(relay => !isPrivateUrl(relay)).slice(0, MAX_HINTS),
  ]
  // Undefined means "the reader's own relays", which is what the pool does by default.
  return extra.length === 0 ? undefined : [...new Set([...mine, ...extra])]
}

/** Relay hints honoured from one link. */
const MAX_HINTS = 3

export function useThread(
  id: Hex | undefined,
  hints: RelayUrl[] = [],
  author?: Hex,
): ThreadApi {
  // Seeded from the cache in the initialiser, so a note opened from the timeline.
  const [target, setTarget] = useState<NostrEvent | undefined>(() => getCachedEvent(id))
  const [ancestors, setAncestors] = useState<NostrEvent[]>([])
  const [replies, setReplies] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(id !== undefined)
  const [settled, setSettled] = useState(false)

  /** A REPLY THIS READER JUST WROTE, in the thread they wrote. */
  useEffect(() => {
    return onPublished(event => {
      // A comment we just wrote belongs here as much as a kind-1 reply does.
      if (!REPLY_KINDS.includes(event.kind as number)) return
      const parent = parentOf(event)
      if (parent === undefined) return
      setReplies(current => {
        const known = new Set<string>(current.map(reply => reply.id))
        if (id !== undefined) known.add(id)
        if (!known.has(parent) || known.has(event.id)) return current
        rememberEvent(event)
        return [...current, event]
      })
    })
  }, [id])

  /** And take it away again if no relay would take. */
  useEffect(() => {
    return onRetracted(gone => {
      setReplies(current =>
        current.some(reply => reply.id === gone)
          ? current.filter(reply => reply.id !== gone)
          : current,
      )
    })
  }, [])

  // hints is a fresh array on every render.
  const hintKey = hints.join(',')

  useEffect(() => {
    let cancelled = false
    const cached = getCachedEvent(id)
    // Only cleared on a miss.
    setTarget(cached)
    setAncestors([])
    setReplies([])
    setSettled(false)
    if (id === undefined) {
      setLoading(false)
      return
    }
    setLoading(cached === undefined)

    void (async () => {
      const pool = getPool()
      // this author the lookup below already knows where to go.
      let extra = relaysFor(hintKey === '' ? [] : (hintKey.split(',') as RelayUrl[]), author)

      // Skip the lookup entirely on a cache hit.
      const found = cached ?? (await pool.query([{ ids: [id] }], extra))[0]
      if (cancelled) return
      if (found !== undefined) rememberEvent(found)
      if (found === undefined) {
        setLoading(false)
        setSettled(true)
        return
      }
      setTarget(found)

      /* NOW we know who wrote it, even when the link did not say. */
      extra = relaysFor(hintKey === '' ? [] : (hintKey.split(',') as RelayUrl[]), found.pubkey as Hex)

      const root = getThreadRoot(found)
      const [above, below] = await Promise.all([
        // Fetch the whole thread by root rather than walking parent links one at a time.
        root === undefined
          ? Promise.resolve<NostrEvent[]>([])
          : pool.query(
              [{ ids: [root] }, { kinds: [...REPLY_KINDS], '#e': [root] }],
              extra,
            ),
        pool.query([{ kinds: [...REPLY_KINDS], '#e': [id] }], extra),
      ])
      if (cancelled) return

      const byId = new Map<string, NostrEvent>()
      for (const event of [...above, ...below, found]) byId.set(event.id, event)

      // Walk up from the target through whatever we collected.
      const chain: NostrEvent[] = []
      const seen = new Set<string>([found.id])
      let cursor: NostrEvent | undefined = found
      while (cursor !== undefined) {
        const parentId: Hex | undefined = parentOf(cursor)
        if (parentId === undefined || seen.has(parentId)) break
        seen.add(parentId)
        const parent: NostrEvent | undefined = byId.get(parentId)
        if (parent === undefined) break
        chain.unshift(parent)
        cursor = parent
      }

      setAncestors(chain)
      /** Answers only, checked HERE and not left to the relay. */
      setReplies(
        [...byId.values()].filter(
          event => REPLY_KINDS.includes(event.kind as number) && event.id !== id && !seen.has(event.id),
        ),
      )
      setLoading(false)
      setSettled(true)
    })()

    return () => {
      cancelled = true
    }
  }, [id, hintKey, author])

  const tree = useMemo(() => {
    if (target === undefined) return []
    /** Quotes are not part of the thread. */
    const actual = replies.filter(isReply)
    // Seed the tree with the target so direct replies attach to something.
    return buildThreadTree([target, ...actual]).flatMap(node =>
      node.event.id === target.id ? node.children : [node],
    )
  }, [target, replies])

  return {
    target,
    ancestors,
    replies: tree,
    loading,
    missing: settled && target === undefined,
  }
}

/** NIP-10 parent: the `reply` marker if present, else the `root`, else nothing. */
export function parentOf(event: NostrEvent): Hex | undefined {
  let root: Hex | undefined
  for (const tag of event.tags) {
    if (tag[0] !== 'e') continue
    const id = tag[1]
    if (id === undefined) continue
    const marker = tag[3]
    if (marker === 'reply') return id
    if (marker === 'root') root = id
    // Unmarked legacy form: the LAST e-tag is the direct parent, so keep overwriting.
    if (marker === undefined || marker === '') root = id
  }
  return root
}
