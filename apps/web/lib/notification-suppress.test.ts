import { describe, expect, it } from 'vitest'
import { KINDS, type Hex, type NostrEvent } from '@nostrich/nostr'

import { markDeleted } from './deleted'
import { addToList } from './user-lists'
import {
  announceableActor,
  bookmarkActor,
  notificationTarget,
  reactsToOwnReaction,
  suppressed,
} from './notification-suppress'

/** These tests exist to keep the DOT and the PAGE saying the same thing. */

const key = (n: number): Hex => n.toString(16).padStart(64, '0') as Hex

const note = (over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: key(999),
    pubkey: key(1),
    kind: KINDS.shortNote,
    created_at: 1_700_000_000,
    content: 'hello',
    tags: [],
    sig: '',
    ...over,
  }) as NostrEvent

describe('suppressed', () => {
  it('lets an ordinary reply through', () => {
    expect(suppressed(note({ tags: [['e', key(50)]] }))).toBe(false)
  })

  it('drops a broadcast tagging more accounts than a note ever addresses', () => {
    const tags = Array.from({ length: 40 }, (_, i) => ['p', key(i + 100)])
    expect(suppressed(note({ tags }))).toBe(true)
  })

  it('exempts a zap receipt from the broadcast cap, those tags are the server ZAP_RECEIPT', () => {
    // A receipt's tags belong to the lightning server, not the sender.
    const tags = Array.from({ length: 40 }, (_, i) => ['p', key(i + 100)])
    expect(suppressed(note({ kind: 9735, tags }))).toBe(false)
  })

  it('exempts a contact list, a big follow list is not a mass mention', () => {
    const tags = Array.from({ length: 40 }, (_, i) => ['p', key(i + 100)])
    expect(suppressed(note({ kind: KINDS.contacts, tags }))).toBe(false)
  })

  it('drops anything from a muted account', () => {
    const muted = key(7)
    addToList('muted', muted)
    expect(suppressed(note({ pubkey: muted, tags: [['e', key(50)]] }))).toBe(true)
  })

  it('drops a reply to a note the reader deleted', () => {
    const gone = key(60)
    markDeleted(gone)
    expect(suppressed(note({ tags: [['e', gone]] }))).toBe(true)
  })

  it('drops a LIKE of a deleted note, read from the last e-tag as NIP-25 requires', () => {
    // The earlier e-tags are inherited thread context.
    const gone = key(61)
    markDeleted(gone)
    expect(suppressed(note({ kind: KINDS.reaction, content: '+', tags: [['e', key(62)], ['e', gone]] }))).toBe(true)
  })
})

describe('notificationTarget', () => {
  it('reads a q tag when there is no e tag, a modern quote carries no e tag at all', () => {
    expect(notificationTarget(note({ tags: [['q', key(70)]] }))).toBe(key(70))
  })

  it('prefers the e tag, which for a reply is the note being answered', () => {
    expect(notificationTarget(note({ tags: [['e', key(71)], ['q', key(72)]] }))).toBe(key(71))
  })
})

describe('bookmarkActor', () => {
  it('reads the saver back out of a bookmark key', () => {
    // The dot counts straight out of the keyed map and has no entry objects to hand.
    expect(bookmarkActor(`${key(90)}:${key(91)}`)).toBe(key(90))
  })
})

describe('announceableActor', () => {
  it('announces a stranger', () => {
    expect(announceableActor(key(80))).toBe(true)
  })

  it('does not announce a muted account, following OR bookmarking', () => {
    // Following somebody is not an event addressed to them, so it never passes.
    const muted = key(81)
    addToList('muted', muted)
    expect(announceableActor(muted)).toBe(false)
  })
})

describe('reactsToOwnReaction', () => {
  /** Reported: an account that works down the timeline liking other people's likes. */
  const MY_LIKE = key(70)
  const mine = new Set([MY_LIKE])
  const like = (target: Hex) =>
    note({ kind: KINDS.reaction, content: '+', tags: [['e', target]] })

  it('drops a reaction to one of our own reactions', () => {
    expect(reactsToOwnReaction(like(MY_LIKE), mine)).toBe(true)
  })

  it('keeps a reaction to one of our NOTES', () => {
    expect(reactsToOwnReaction(like(key(71)), mine)).toBe(false)
  })

  it('reads the LAST e-tag, as NIP-25 requires', () => {
    // The earlier e-tags are inherited thread context.
    const inThread = note({ kind: KINDS.reaction, content: '+', tags: [['e', key(72)], ['e', MY_LIKE]] })
    expect(reactsToOwnReaction(inThread, mine)).toBe(true)
  })

  it('has no opinion on anything that is not a reaction', () => {
    expect(reactsToOwnReaction(note({ tags: [['e', MY_LIKE]] }), mine)).toBe(false)
  })

  it('costs nothing when we have published no reactions', () => {
    expect(reactsToOwnReaction(like(MY_LIKE), new Set())).toBe(false)
  })
})
