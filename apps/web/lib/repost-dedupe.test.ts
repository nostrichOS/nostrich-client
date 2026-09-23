import { describe, expect, it } from 'vitest'

import { displayedNote } from './reposts'
import { KINDS, type NostrEvent } from '@nostrich/nostr'

/** One row per note, whoever brought it here. */

/** Real-shaped ids. */
function hex(seed: string): string {
  return seed.repeat(64).slice(0, 64)
}

function note(seed: string, pubkey = 'author'): NostrEvent {
  return {
    id: hex(seed),
    pubkey,
    kind: KINDS.shortNote,
    created_at: 100,
    tags: [],
    content: 'hi',
    sig: '',
  } as NostrEvent
}

/** The common shape: an `e` tag and NO embedded note. */
function repost(seed: string, of: NostrEvent, by = 'booster'): NostrEvent {
  return {
    id: hex(seed),
    pubkey: by,
    kind: KINDS.repost,
    created_at: 200,
    tags: [['e', of.id]],
    content: '',
    sig: '',
  } as NostrEvent
}

/** The gate from FeedScreen, isolated. */
function collapse(feed: NostrEvent[]): NostrEvent[] {
  const originals = new Set(feed.filter(e => e.kind !== KINDS.repost).map(e => e.id))
  const subjectOf = (event: NostrEvent): string => {
    const shown = displayedNote(event)
    return shown.missingId ?? shown.inner.id
  }
  const shownOnce = new Set<string>()
  return feed.filter(event => {
    const subject = subjectOf(event)
    if (event.kind === KINDS.repost && originals.has(subject)) return false
    if (shownOnce.has(subject)) return false
    shownOnce.add(subject)
    return true
  })
}

describe('a note and a repost of it', () => {
  it('keeps the original and drops the repost', () => {
    const original = note('1')
    const kept = collapse([original, repost('a', original)])
    expect(kept.map(e => e.id)).toEqual([hex('1')])
  })

  /** Order must not decide it: the repost usually lands FIRST, seconds after the note. */
  it('keeps the original even when the repost arrived first', () => {
    const original = note('1')
    const kept = collapse([repost('a', original), original])
    expect(kept.map(e => e.id)).toEqual([hex('1')])
  })

  it('collapses several reposts of the same note into one row', () => {
    const original = note('1')
    const kept = collapse([repost('a', original, 'x'), repost('b', original, 'y')])
    expect(kept.map(e => e.id)).toEqual([hex('a')])
  })

  /** The case that must never break. */
  it('leaves a repost of a note that is not otherwise here', () => {
    const stranger = note('9', 'stranger')
    const kept = collapse([note('1'), repost('a', stranger)])
    expect(kept.map(e => e.id)).toEqual([hex('1'), hex('a')])
  })

  it('does not touch unrelated notes', () => {
    const kept = collapse([note('1'), note('2'), note('3')])
    expect(kept).toHaveLength(3)
  })
})
