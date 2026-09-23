import { getTagValues } from './events'
import type { NostrEvent } from './types'

/** EDITED NOTES. */

/** another client's "Content Change Event". */
export const EDIT_KIND = 1010

/** The note an edit claims to rewrite, if it names exactly one. */
export function editTarget(edit: NostrEvent): string | undefined {
  if (edit.kind !== EDIT_KIND) return undefined
  const targets = getTagValues(edit, 'e').filter(id => id.length === 64)
  /* EXACTLY ONE, never the first of several. */
  return targets.length === 1 ? targets[0] : undefined
}

/** Whether this edit may be applied to this note. */
export function editApplies(edit: NostrEvent, note: NostrEvent): boolean {
  if (note.kind !== 1) return false
  if (editTarget(edit) !== note.id) return false
  if (edit.pubkey !== note.pubkey) return false
  return edit.created_at > note.created_at
}

/** The edit a note should actually show, out of everything offered. */
export function newestEdit(
  edits: readonly NostrEvent[],
  note: NostrEvent,
): NostrEvent | undefined {
  let best: NostrEvent | undefined
  for (const edit of edits) {
    if (!editApplies(edit, note)) continue
    if (best === undefined || edit.created_at > best.created_at) best = edit
  }
  return best
}

/** The note as its author last meant it, plus whether that differs. */
export function applyEdit(
  note: NostrEvent,
  edits: readonly NostrEvent[],
): { event: NostrEvent; edited: boolean; editedAt?: number } {
  const edit = newestEdit(edits, note)
  if (edit === undefined) return { event: note, edited: false }
  /* An edit to nothing is not an edit. */
  if (edit.content.trim() === '') return { event: note, edited: false }
  return {
    event: { ...note, content: edit.content },
    edited: true,
    editedAt: edit.created_at,
  }
}
