'use client'

import { useSyncExternalStore } from 'react'

/** Unsent notes, kept on this device. */

const KEY = 'nostrich:drafts'
/** Enough to be useful, few enough that the list is scannable without search. */
const CAP = 20

export interface Draft {
  id: string
  text: string
  /** Seconds, matching every other timestamp in this app. */
  savedAt: number
  /** `@Name` -> pubkey, for the mentions this draft has already resolved. */
  mentions?: Record<string, string>
}

/** A stored mentions map, or undefined if it is not one. */
function readMentions(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [token, pubkey] of Object.entries(value as Record<string, unknown>)) {
    if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/u.test(pubkey)) continue
    out[token] = pubkey
  }
  return Object.keys(out).length === 0 ? undefined : out
}

let drafts: Draft[] | null = null
const listeners = new Set<() => void>()
const EMPTY: Draft[] = []

function read(): Draft[] {
  if (typeof window === 'undefined') return EMPTY
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return EMPTY
    return parsed
      .filter(
        (item): item is Draft =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Draft).id === 'string' &&
          typeof (item as Draft).text === 'string' &&
          typeof (item as Draft).savedAt === 'number',
      )
      .map(item => {
        const mentions = readMentions((item as { mentions?: unknown }).mentions)
        return mentions === undefined
          ? { id: item.id, text: item.text, savedAt: item.savedAt }
          : { id: item.id, text: item.text, savedAt: item.savedAt, mentions }
      })
  } catch {
    // Corrupt storage must not take the composer down.
    return EMPTY
  }
}

function write(next: Draft[]): void {
  drafts = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Quota or private mode.
  }
  for (const listener of listeners) listener()
}

function current(): Draft[] {
  if (drafts === null) drafts = read()
  return drafts
}

export function saveDraft(text: string, id?: string, mentions?: Record<string, string>): void {
  const trimmed = text.trim()
  if (trimmed === '') return
  const savedAt = Math.floor(Date.now() / 1000)
  const list = current()
  // Editing an existing draft replaces it rather than piling up a near-duplicate.
  const without = id === undefined ? list : list.filter(draft => draft.id !== id)
  // Only the tokens this text still contains: a name picked, then deleted.
  const kept = readMentions(
    Object.fromEntries(Object.entries(mentions ?? {}).filter(([token]) => trimmed.includes(token))),
  )
  const entry: Draft = {
    id: id ?? Math.random().toString(36).slice(2, 10),
    text: trimmed,
    savedAt,
    ...(kept === undefined ? {} : { mentions: kept }),
  }
  write([entry, ...without].slice(0, CAP))
}

export function removeDraft(id: string): void {
  write(current().filter(draft => draft.id !== id))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDrafts(): Draft[] {
  return useSyncExternalStore(
    subscribe,
    () => current(),
    // Server render: no drafts in the HTML, so the count cannot flash before hydration.
    () => EMPTY,
  )
}
