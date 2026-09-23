'use client'

import { useEffect, useMemo, useState } from 'react'
import { EDIT_KIND, applyEdit, editTarget, type NostrEvent } from '@nostrich/nostr'

import { getPool } from './pool'

/** CORRECTIONS PUBLISHED FOR THE NOTES ON SCREEN. */

/** Long enough to collect a screenful, short enough that nobody waits. */
const BATCH_WINDOW_MS = 90
/** Ids per filter. */
const MAX_BATCH = 100
const TIMEOUT_MS = 6_000

/** Edits seen this session, by the note they target. */
const known = new Map<string, NostrEvent[]>()
const pending = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

async function flush(): Promise<void> {
  timer = undefined
  const ids = [...pending].slice(0, MAX_BATCH)
  if (ids.length === 0) return
  for (const id of ids) pending.delete(id)

  let events: NostrEvent[] = []
  try {
    events = await getPool().query(
      [{ kinds: [EDIT_KIND], '#e': ids, limit: MAX_BATCH }] as never,
      undefined,
      TIMEOUT_MS,
    )
  } catch {
    /* A relay that will not answer is not evidence that a note is unedited. */
  }

  for (const id of ids) if (!known.has(id)) known.set(id, [])
  for (const event of events) {
    const target = editTarget(event)
    if (target === undefined) continue
    const held = known.get(target)
    if (held === undefined) known.set(target, [event])
    else if (!held.some(seen => seen.id === event.id)) held.push(event)
  }
  notify()
}

function request(id: string): void {
  if (known.has(id) || pending.has(id)) return
  pending.add(id)
  if (pending.size >= MAX_BATCH) {
    void flush()
    return
  }
  if (timer === undefined) timer = setTimeout(() => void flush(), BATCH_WINDOW_MS)
}

/** The note as its author last meant. */
export function useEdited(note: NostrEvent): {
  event: NostrEvent
  edited: boolean
  /** When the correction was published. */
  editedAt?: number
} {
  const [, bump] = useState(0)

  useEffect(() => {
    if (note.kind !== 1) return
    const listener = (): void => bump(n => n + 1)
    listeners.add(listener)
    request(note.id)
    return () => {
      listeners.delete(listener)
    }
  }, [note.id, note.kind])

  return useMemo(() => {
    if (note.kind !== 1) return { event: note, edited: false }
    const found = known.get(note.id)
    if (found === undefined || found.length === 0) return { event: note, edited: false }
    return applyEdit(note, found)
    // `known` is a module store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, listeners.size, known.get(note.id)?.length])
}

/** Test seam: drop everything learned this session. */
export function forgetEdits(): void {
  known.clear()
  pending.clear()
  notify()
}
