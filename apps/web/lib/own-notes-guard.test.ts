import { describe, expect, it } from 'vitest'
import type { Hex, NostrEvent } from '@nostrich/nostr'

import { noteNotificationKind } from './note-notifications'

/** Why losing the reader's own notes deletes every reply notification. */

const ME = 'a'.repeat(64) as Hex
const THEM = 'b'.repeat(64) as Hex
const MY_NOTE = 'c'.repeat(64)

const replyToMe = (): NostrEvent =>
  ({
    id: 'd'.repeat(64),
    pubkey: THEM,
    kind: 1,
    created_at: 100,
    // A perfectly ordinary reply: it tags the note and its author, and writes neither.
    tags: [
      ['e', MY_NOTE, '', 'root'],
      ['p', ME],
    ],
    content: 'good point',
    sig: '',
  }) as NostrEvent

describe('a reply, with and without the note it answers', () => {
  it('is a reply when the answered note is known to be ours', () => {
    expect(noteNotificationKind(replyToMe(), ME, new Set([MY_NOTE]))).toBe('reply')
  })

  it('IS DROPPED ENTIRELY when it is not, the bug, in one line', () => {
    expect(noteNotificationKind(replyToMe(), ME, new Set())).toBeNull()
  })

  it('survives only if the replier happened to write our npub in the body', () => {
    const mentioned = { ...replyToMe(), content: `good point nostr:${'x'.repeat(4)}` } as NostrEvent
    // Not a real npub, so still dropped: a p-tag alone is not enough once the note.
    expect(noteNotificationKind(mentioned, ME, new Set())).toBeNull()
  })

  it('still refuses our own note, whatever the set holds', () => {
    const mine = { ...replyToMe(), pubkey: ME } as NostrEvent
    expect(noteNotificationKind(mine, ME, new Set([MY_NOTE]))).toBeNull()
  })
})
