import { describe, expect, it } from 'vitest'

import { EDIT_KIND, applyEdit, editApplies, editTarget, newestEdit } from './edited'
import type { NostrEvent } from './types'

/** Reading another client's edits, which have no NIP behind them. */

const AUTHOR = 'a'.repeat(64)
const STRANGER = 'b'.repeat(64)
const NOTE_ID = 'c'.repeat(64)
const OTHER_ID = 'd'.repeat(64)

const makeNote = (over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: NOTE_ID,
    pubkey: AUTHOR,
    kind: 1,
    created_at: 1000,
    content: 'orignal typo',
    tags: [],
    sig: '',
    ...over,
  }) as NostrEvent

const edit = (over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: 'e'.repeat(64),
    pubkey: AUTHOR,
    kind: EDIT_KIND,
    created_at: 2000,
    content: 'original, fixed',
    tags: [['e', NOTE_ID], ['alt', 'Content Change Event']],
    sig: '',
    ...over,
  }) as NostrEvent

describe('editTarget', () => {
  it('reads the single note an edit names', () => {
    expect(editTarget(edit())).toBe(NOTE_ID)
  })

  it('refuses an edit naming two notes', () => {
    /* All 109 measured carry exactly one `e` tag, so two is not a shape anybody publishes. */
    expect(editTarget(edit({ tags: [['e', NOTE_ID], ['e', OTHER_ID]] }))).toBeUndefined()
  })

  it('ignores an event that is not an edit at all', () => {
    expect(editTarget(makeNote())).toBeUndefined()
  })
})

describe('editApplies', () => {
  it('accepts the author correcting their own note', () => {
    expect(editApplies(edit(), makeNote())).toBe(true)
  })

  it('REFUSES an edit from anybody else', () => {
    /* THE ONE THAT HAPPENS IN THE WILD. */
    expect(editApplies(edit({ pubkey: STRANGER }), makeNote())).toBe(false)
  })

  it('refuses an edit aimed at a different note', () => {
    expect(editApplies(edit({ tags: [['e', OTHER_ID]] }), makeNote())).toBe(false)
  })

  it('refuses an edit older than the note it claims to fix', () => {
    // A correction dated before the thing it corrects is a clock problem or a replay.
    expect(editApplies(edit({ created_at: 500 }), makeNote())).toBe(false)
    expect(editApplies(edit({ created_at: 1000 }), makeNote())).toBe(false)
  })

  it('only ever edits a kind-1', () => {
    // The convention edits nothing else.
    expect(editApplies(edit(), makeNote({ kind: 30023 }))).toBe(false)
  })
})

describe('newestEdit', () => {
  it('takes the latest correction', () => {
    // Nine of the sampled notes carried more than one.
    const older = edit({ id: '1'.repeat(64), created_at: 2000, content: 'first try' })
    const newer = edit({ id: '2'.repeat(64), created_at: 3000, content: 'final' })
    expect(newestEdit([older, newer], makeNote())?.content).toBe('final')
    expect(newestEdit([newer, older], makeNote())?.content).toBe('final')
  })

  it('skips the invalid ones while choosing', () => {
    const forged = edit({ id: '3'.repeat(64), created_at: 9000, pubkey: STRANGER, content: 'not theirs' })
    const real = edit({ id: '4'.repeat(64), created_at: 2500, content: 'theirs' })
    expect(newestEdit([forged, real], makeNote())?.content).toBe('theirs')
  })
})

describe('applyEdit', () => {
  it('returns the note untouched when nothing edits it', () => {
    const original = makeNote()
    const result = applyEdit(original, [])
    expect(result.event).toBe(original)
    expect(result.edited).toBe(false)
  })

  it('swaps in the new text and says so', () => {
    const result = applyEdit(makeNote(), [edit()])
    expect(result.event.content).toBe('original, fixed')
    expect(result.edited).toBe(true)
  })

  it('keeps the ORIGINAL timestamp', () => {
    /* It is the same note, posted when it was posted. */
    expect(applyEdit(makeNote(), [edit()]).event.created_at).toBe(1000)
    expect(applyEdit(makeNote(), [edit()]).editedAt).toBe(2000)
  })

  it('never blanks a note', () => {
    // another client cannot produce.
    expect(applyEdit(makeNote(), [edit({ content: '   ' })]).edited).toBe(false)
    expect(applyEdit(makeNote(), [edit({ content: '' })]).event.content).toBe('orignal typo')
  })

  it('leaves everything else about the event alone', () => {
    const original = makeNote({ tags: [['t', 'nostr']] })
    const result = applyEdit(original, [edit()])
    expect(result.event.id).toBe(original.id)
    expect(result.event.pubkey).toBe(original.pubkey)
    expect(result.event.tags).toEqual(original.tags)
  })
})
