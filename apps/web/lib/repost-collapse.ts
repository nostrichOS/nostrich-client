import { KINDS, type NostrEvent } from '@nostrich/nostr'

import { displayedNote } from './reposts'

/** One note, one row. */
export function collapseReposts(notes: readonly NostrEvent[]): NostrEvent[] {
  const originals = new Set(
    notes.filter(note => note.kind !== KINDS.repost).map(note => note.id),
  )

  /** Which note a row is ABOUT, envelope. */
  const subjectOf = (note: NostrEvent): string => {
    const shown = displayedNote(note)
    return shown.missingId ?? shown.inner.id
  }

  const shownOnce = new Set<string>()
  return notes.filter(note => {
    const subject = subjectOf(note)
    if (note.kind === KINDS.repost && originals.has(subject)) return false
    if (shownOnce.has(subject)) return false
    shownOnce.add(subject)
    return true
  })
}
