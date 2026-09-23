import { describe, expect, it } from 'vitest'
import { encodeNprofile, encodeNpub, type Hex, type NostrEvent } from '@nostrich/nostr'

import { noteNotificationKind } from './note-notifications'

/** The bug: being mentioned once in somebody else's note signs you up for the whole. */

const ME = '11'.repeat(32) as Hex
const THEM = '22'.repeat(32) as Hex
const MY_NOTE = 'aa'.repeat(32)
const THEIR_NOTE = 'bb'.repeat(32)
const MINE = new Set([MY_NOTE])

function note(patch: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'ee'.repeat(32),
    pubkey: THEM,
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: '',
    sig: '0'.repeat(128),
    ...patch,
  }
}

/** A reply as NIP-10 marks one: the root first, the parent marked `reply`. */
const replyTo = (parent: string, patch: Partial<NostrEvent> = {}) =>
  note({
    tags: [
      ['e', THEIR_NOTE, '', 'root'],
      ['e', parent, '', 'reply'],
      ['p', ME],
    ],
    ...patch,
  })

/** A reply as another client writes one now: NIP-22, uppercase root scope, lowercase. */
const commentOn = (parent: string, root = parent, patch: Partial<NostrEvent> = {}) =>
  note({
    kind: 1111,
    tags: [
      ['E', root, '', ME],
      ['K', '1'],
      ['P', ME, ''],
      ['e', parent, '', ME],
      ['k', '1'],
      ['p', ME, ''],
      ['client', 'SomeClient'],
    ],
    ...patch,
  })

describe('NIP-22 comments', () => {
  it('announces a comment on my note as a reply', () => {
    // Before kind 1111 was read, this was silence: no row, no count, no error.
    expect(noteNotificationKind(commentOn(MY_NOTE), ME, MINE)).toBe('reply')
  })

  it('does not announce a comment on somebody else’s note that never names me', () => {
    // The same rule that keeps a stranger's thread out of the column when it is NIP-10.
    const elsewhere = commentOn(THEIR_NOTE, THEIR_NOTE, { tags: [
      ['E', THEIR_NOTE, '', THEM],
      ['K', '1'],
      ['e', THEIR_NOTE, '', THEM],
      ['k', '1'],
      ['p', THEM, ''],
    ] })
    expect(noteNotificationKind(elsewhere, ME, MINE)).toBeNull()
  })

  it('reads a nested comment by its parent, not by the thread root', () => {
    // `E` names the root and `e` the parent.
    const nested = commentOn(THEIR_NOTE, MY_NOTE)
    expect(noteNotificationKind(nested, ME, MINE)).toBeNull()
  })

  it('announces a nested comment that actually names me in its text', () => {
    // The p-tag alone is not enough.
    const named = commentOn(THEIR_NOTE, MY_NOTE, { content: `hey nostr:${encodeNpub(ME)} look` })
    expect(noteNotificationKind(named, ME, MINE)).toBe('mention')
  })

  it('is never news when I wrote it myself', () => {
    expect(noteNotificationKind(commentOn(MY_NOTE, MY_NOTE, { pubkey: ME }), ME, MINE)).toBeNull()
  })
})

describe('noteNotificationKind', () => {
  it('keeps a reply to YOUR note', () => {
    expect(noteNotificationKind(replyTo(MY_NOTE), ME, MINE)).toBe('reply')
  })

  /** The whole point: p-tagged, in a thread, about a note that is not yours. */
  it('drops a reply to somebody else’s note that never names you', () => {
    expect(noteNotificationKind(replyTo(THEIR_NOTE), ME, MINE)).toBeNull()
  })

  it('keeps it as a MENTION when the body actually names you', () => {
    const npub = encodeNpub(ME)
    expect(noteNotificationKind(replyTo(THEIR_NOTE, { content: `what do you think nostr:${npub}` }), ME, MINE)).toBe(
      'mention',
    )
  })

  it('reads an nprofile and a legacy #[n] reference as naming you too', () => {
    const nprofile = encodeNprofile({ pubkey: ME })
    expect(noteNotificationKind(replyTo(THEIR_NOTE, { content: `hi nostr:${nprofile}` }), ME, MINE)).toBe('mention')

    const legacy = note({
      tags: [
        ['e', THEIR_NOTE, '', 'root'],
        ['e', THEIR_NOTE, '', 'reply'],
        ['p', ME],
      ],
      content: 'hi #[2]',
    })
    expect(noteNotificationKind(legacy, ME, MINE)).toBe('mention')
  })

  /** NIP-10: the marked `reply` tag is the note being answered. */
  it('asks about the parent, not the thread root', () => {
    const inMyThread = note({
      tags: [
        ['e', MY_NOTE, '', 'root'],
        ['e', THEIR_NOTE, '', 'reply'],
        ['p', ME],
      ],
    })
    expect(noteNotificationKind(inMyThread, ME, MINE)).toBeNull()
  })

  it('treats a single unmarked e-tag as the parent, which is all it can be', () => {
    expect(noteNotificationKind(note({ tags: [['e', MY_NOTE], ['p', ME]] }), ME, MINE)).toBe('reply')
    expect(noteNotificationKind(note({ tags: [['e', THEIR_NOTE], ['p', ME]] }), ME, MINE)).toBeNull()
  })

  describe('quotes', () => {
    it('keeps a quote of your note', () => {
      expect(noteNotificationKind(note({ tags: [['q', MY_NOTE], ['p', ME]] }), ME, MINE)).toBe('quote')
    })

    it('drops a quote of somebody else’s note that merely tags you', () => {
      expect(noteNotificationKind(note({ tags: [['q', THEIR_NOTE], ['p', ME]] }), ME, MINE)).toBeNull()
    })

    it('understands the older mention-marked e-tag as a quote', () => {
      const old = note({ tags: [['e', MY_NOTE, '', 'mention'], ['p', ME]] })
      expect(noteNotificationKind(old, ME, MINE)).toBe('quote')
    })
  })

  it('leaves a plain mention alone, tagged in the body or not', () => {
    expect(noteNotificationKind(note({ tags: [['p', ME]] }), ME, MINE)).toBe('mention')
    const npub = encodeNpub(ME)
    expect(noteNotificationKind(note({ tags: [['p', ME]], content: `nostr:${npub}` }), ME, MINE)).toBe('mention')
  })

  it('never notifies you about your own note', () => {
    expect(noteNotificationKind(replyTo(MY_NOTE, { pubkey: ME }), ME, MINE)).toBeNull()
    expect(noteNotificationKind(note({ pubkey: ME, tags: [['p', ME]] }), ME, MINE)).toBeNull()
  })

  it('drops everything when none of your notes are known yet', () => {
    // The set is empty before the first fetch lands.
    expect(noteNotificationKind(replyTo(MY_NOTE), ME, new Set())).toBeNull()
  })
})

/** The thread-mention switch. */
describe('noteNotificationKind with thread mentions enabled', () => {
  const me = 'a'.repeat(64) as Hex
  const them = 'b'.repeat(64) as Hex
  const theirNote = 'c'.repeat(64)

  const inheritedReply = {
    id: 'd'.repeat(64),
    pubkey: them,
    kind: 1,
    created_at: 1,
    // Answers somebody ELSE's note, carries my p-tag down from higher in the thread.
    tags: [['e', theirNote, '', 'reply'], ['p', me]],
    content: 'sounds good to me',
    sig: '',
  } as unknown as NostrEvent

  it('refuses an inherited p-tag by default', () => {
    expect(noteNotificationKind(inheritedReply, me, new Set())).toBeNull()
  })

  it('admits it as its OWN kind, not as a mention, once the reader asks for it', () => {
    // `thread`, because "mentioned you" would claim the author wrote the reader's name.
    expect(noteNotificationKind(inheritedReply, me, new Set(), true)).toBe('thread')
  })

  it('still calls it a mention when the author actually wrote the name', () => {
    const named = { ...inheritedReply, content: `hey nostr:${encodeNpub(me)}` } as NostrEvent
    expect(noteNotificationKind(named, me, new Set(), true)).toBe('mention')
    // And with the switch off, a real mention is unaffected either way.
    expect(noteNotificationKind(named, me, new Set())).toBe('mention')
  })

  it('still refuses a reply that does not tag me at all', () => {
    const untagged = { ...inheritedReply, tags: [['e', theirNote, '', 'reply']] } as NostrEvent
    expect(noteNotificationKind(untagged, me, new Set(), true)).toBeNull()
  })

  it('does not downgrade a real reply to my own note', () => {
    expect(noteNotificationKind(inheritedReply, me, new Set([theirNote]), true)).toBe('reply')
  })
})
