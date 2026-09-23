import { describe, expect, it } from 'vitest'
import { KINDS, encodeNote, type Hex, type NostrEvent } from '@nostrich/nostr'

import { countedId, displayedNote, repostHints } from './reposts'

/** Which event a row draws, and which id its counts are keyed. */

const hex = (seed: string): Hex => seed.repeat(32).slice(0, 64)

const ALICE = hex('a1') // wrote the note
const BOB = hex('b0') // reposted it
const MALLORY = hex('c7') // would like to be rendered as somebody else

const NOTE_ID = hex('1a')
const ENVELOPE_ID = hex('6e')
const FORGED_ID = hex('9d')

const SIG = 'f'.repeat(128)

function note(over: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: NOTE_ID,
    pubkey: ALICE,
    created_at: 1_800_000_000,
    kind: KINDS.shortNote,
    tags: [],
    content: 'gm',
    sig: SIG,
    ...over,
  }
}

/** A NIP-18 kind-6: the original embedded as JSON in `content`, pointed at by an `e`. */
function repost(inner: NostrEvent = note(), over: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: ENVELOPE_ID,
    pubkey: BOB,
    created_at: 1_800_000_100,
    kind: KINDS.repost,
    tags: [
      ['e', inner.id, ''],
      ['p', inner.pubkey],
    ],
    content: JSON.stringify(inner),
    sig: SIG,
    ...over,
  }
}

describe('a plain note', () => {
  it('is its own row', () => {
    const event = note()
    const shown = displayedNote(event)

    // Identity, not a copy: the card memoises on this reference.
    expect(shown.inner).toBe(event)
    expect(shown.repostedBy).toBeUndefined()
    expect(shown.missingId).toBeUndefined()
    expect(countedId(event)).toBe(NOTE_ID)
  })
})

describe('a repost carrying the original', () => {
  it('renders the note, credited to the person who wrote it', () => {
    const shown = displayedNote(repost())

    expect(shown.inner.id).toBe(NOTE_ID)
    expect(shown.inner.pubkey).toBe(ALICE)
    expect(shown.inner.content).toBe('gm')
    expect(shown.repostedBy).toBe(BOB)
  })

  /** The profile-page bug. */
  it('counts against the note, not the envelope', () => {
    expect(countedId(repost())).toBe(NOTE_ID)
  })

  it('leaves nothing to fetch', () => {
    expect(displayedNote(repost()).missingId).toBeUndefined()
  })
})

describe('a repost with no usable copy inside', () => {
  /** Clients that publish a kind-6 with an empty content, and relays that hand back. */
  it('falls back to the envelope and names the note that is missing', () => {
    const unusable = ['', 'not json at all', `{"id":"${NOTE_ID}"}`]

    for (const content of unusable) {
      const shown = displayedNote(repost(note(), { content }))
      expect(shown.inner.id, content).toBe(ENVELOPE_ID)
      expect(shown.repostedBy, content).toBe(BOB)
      expect(shown.missingId, content).toBe(NOTE_ID)
    }
  })

  /** The embedded copy is attacker-controlled and its signature is never checked here. */
  it('refuses an embedded event the tags do not point at', () => {
    const forged = note({ id: FORGED_ID, pubkey: MALLORY, content: 'send me sats' })
    const shown = displayedNote(repost(note(), { content: JSON.stringify(forged) }))

    expect(shown.inner.pubkey).not.toBe(MALLORY)
    expect(shown.inner.id).toBe(ENVELOPE_ID)
    expect(shown.missingId).toBe(NOTE_ID)
  })

  /** Hex internally, even when the honest answer becomes "nothing to fetch". */
  it('does not pass a bech32 `e` tag off as an id', () => {
    const shown = displayedNote(repost(note(), { content: '', tags: [['e', encodeNote(NOTE_ID)]] }))

    expect(shown.missingId).toBeUndefined()
    expect(shown.repostedBy).toBe(BOB)
  })

  /** Uppercase hex arrives from relays and QR codes. */
  it('lowercases the id it hands back', () => {
    const shouty = NOTE_ID.toUpperCase()
    const shown = displayedNote(repost(note(), { content: '', tags: [['e', shouty]] }))

    expect(shown.missingId).toBe(NOTE_ID)
  })

  // What `countedId` answers in this state is deliberately left unasserted.
})

/** The relay hint on a kind-6, which is how an empty envelope's original gets found. */
describe('repostHints', () => {
  it('takes the relay from the e tag', () => {
    const event = repost(note(), { tags: [['e', NOTE_ID, 'wss://relay-d.example/']] })
    expect(repostHints(event)).toEqual(['wss://relay-d.example/'])
  })

  it('returns nothing when the tag carries no relay', () => {
    expect(repostHints(repost(note(), { tags: [['e', NOTE_ID]] }))).toEqual([])
    expect(repostHints(repost(note(), { tags: [['e', NOTE_ID, '']] }))).toEqual([])
  })

  it('ignores tags that are not e tags', () => {
    expect(repostHints(repost(note(), { tags: [['p', NOTE_ID, 'wss://nope.example']] }))).toEqual([])
  })
})

/** WHOSE REACTIONS A REPOST ROW SHOWS. */
describe('countedId', () => {
  const ORIGINAL = '9edd5e43c72c7fd8ac3e42d6e28b0a97b860e73db31b1fccb9a9b1c7d31b68dd'
  const ENVELOPE = '49e02e799e8100000000000000000000000000000000000000000000000000aa'
  const AUTHOR = 'f27341f6cf1e7abdf894372246332f58fe79c9925d489fe597218017314adfd3'
  const REPOSTER = '5f6dc275f3f9f875'.padEnd(64, '0')

  const emptyRepost = {
    id: ENVELOPE,
    pubkey: REPOSTER,
    kind: 6,
    created_at: 1,
    content: '',
    tags: [
      ['e', ORIGINAL],
      ['p', AUTHOR],
    ],
    sig: 'f'.repeat(128),
  } as unknown as NostrEvent

  it('counts against the reposted note when the envelope carries no copy', () => {
    expect(countedId(emptyRepost)).toBe(ORIGINAL)
  })

  it('never counts against the envelope, which has no reactions of its own', () => {
    expect(countedId(emptyRepost)).not.toBe(ENVELOPE)
  })

  it('still counts an ordinary note against itself', () => {
    const note = { id: ORIGINAL, pubkey: AUTHOR, kind: 1, created_at: 1, content: 'hi', tags: [], sig: 'f'.repeat(128) } as unknown as NostrEvent
    expect(countedId(note)).toBe(ORIGINAL)
  })
})
