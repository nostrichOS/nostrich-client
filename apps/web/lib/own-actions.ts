'use client'

import { useSyncExternalStore } from 'react'
import { KINDS, type NostrEvent } from '@nostrich/nostr'

import { onPublished } from './published'

/** What THIS reader has published at each note, timestamped. */
interface OwnAction {
  kind: 'like' | 'repost' | 'reply'
  /** The published event's own id, so a later deletion can retract exactly this action. */
  eventId: string
  at: number
}

const byNote = new Map<string, OwnAction[]>()
const recorded = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

function notify(): void {
  version += 1
  for (const listener of listeners) listener()
}

function targetNoteOf(event: NostrEvent): string | undefined {
  // The last `e` tag is the note being reacted to / reposted, per NIP-25 and NIP-18.
  for (let i = event.tags.length - 1; i >= 0; i -= 1) {
    const tag = event.tags[i]
    if (tag !== undefined && tag[0] === 'e' && typeof tag[1] === 'string') return tag[1]
  }
  return undefined
}

function record(event: NostrEvent): void {
  if (recorded.has(event.id)) return
  if (event.kind === KINDS.deletion) {
    // A retraction: drop any own action whose event id the deletion names.
    const named = new Set(event.tags.filter(t => t[0] === 'e').map(t => t[1]))
    let changed = false
    for (const [note, actions] of byNote) {
      const kept = actions.filter(action => !named.has(action.eventId))
      if (kept.length !== actions.length) {
        byNote.set(note, kept)
        changed = true
      }
    }
    if (changed) notify()
    return
  }

  let kind: OwnAction['kind']
  if (event.kind === KINDS.reaction) {
    // A '-' is a dislike and never counted anywhere.
    if (event.content.trim() === '-') return
    kind = 'like'
  } else if (event.kind === KINDS.repost || event.kind === 16) kind = 'repost'
  else if (event.kind === KINDS.shortNote || event.kind === KINDS.comment) kind = 'reply'
  else return

  const note = targetNoteOf(event)
  if (note === undefined) return
  recorded.add(event.id)
  const held = byNote.get(note) ?? []
  held.push({ kind, eventId: event.id, at: event.created_at })
  byNote.set(note, held)
  notify()
}

/* Wired once, at module load. */
let wired = false
function wire(): void {
  if (wired) return
  wired = true
  onPublished(record)
}

export interface OwnCounts {
  likes: number
  reposts: number
  replies: number
}

/** Own actions at `note` strictly newer than `since` (the index's builtAt). */
export function ownCountsSince(note: string, since: number): OwnCounts {
  const held = byNote.get(note)
  const counts = { likes: 0, reposts: 0, replies: 0 }
  if (held === undefined) return counts
  for (const action of held) {
    if (action.at <= since) continue
    if (action.kind === 'like') counts.likes += 1
    else if (action.kind === 'repost') counts.reposts += 1
    else counts.replies += 1
  }
  return counts
}

/** The recorder, reachable from tests without a React tree or a publish. */
export const __recordForTest = record

/** Re-render trigger: bumps whenever an own action is recorded or retracted. */
export function useOwnActionsVersion(): number {
  wire()
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
    () => 0,
  )
}
