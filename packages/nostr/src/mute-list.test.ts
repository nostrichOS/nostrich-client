import { describe, expect, it } from 'vitest'

import {
  EMPTY_MUTES,
  MUTE_LIST_KIND,
  buildMuteList,
  hasMute,
  mergeMutes,
  mutedPubkeys,
  newestMuteList,
  parseMuteList,
  parseMuteTags,
  parsePrivateMutes,
  privateMutesPlaintext,
  toggleMute,
  type MuteEntry,
  type MuteList,
} from './mute-list'
import type { Hex, NostrEvent } from './types'

/** The mute list, which is the one replaceable event in this app that can be destroyed. */

const key = (i: number): Hex => (i + 16).toString(16).padStart(2, '0').repeat(32) as Hex
const ALICE = key(0)
const BOB = key(1)

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '11'.repeat(32) as Hex,
    pubkey: ALICE,
    created_at: 1_800_000_000,
    kind: MUTE_LIST_KIND,
    tags: [],
    content: '',
    sig: '0'.repeat(128),
    ...overrides,
  }
}

describe('parseMuteTags', () => {
  it('reads all four entry types, not just accounts', () => {
    const entries = parseMuteTags([
      ['p', ALICE],
      ['t', 'Spam'],
      ['word', 'AIRDROP'],
      ['e', '22'.repeat(32)],
    ])
    expect(entries.map(entry => entry.type)).toEqual(['p', 't', 'word', 'e'])
  })

  it('lowercases text but leaves keys alone', () => {
    // Matching "Bitcoin" case-sensitively would let "bitcoin" straight.
    const entries = parseMuteTags([['t', 'Bitcoin'], ['word', 'FREE MONEY']])
    expect(entries.map(entry => entry.value)).toEqual(['bitcoin', 'free money'])
  })

  it('ignores list metadata and unknown tags', () => {
    const entries = parseMuteTags([['title', 'my mutes'], ['alt', 'x'], ['p', ALICE]])
    expect(entries).toEqual([{ type: 'p', value: ALICE }])
  })

  it('drops duplicates and blanks', () => {
    const entries = parseMuteTags([['p', ALICE], ['p', ALICE], ['p', '  '], ['t', '']])
    expect(entries).toHaveLength(1)
  })

  it('ignores an event of the wrong kind entirely', () => {
    expect(parseMuteList(event({ kind: 30_000, tags: [['p', ALICE]] }))).toEqual([])
  })
})

describe('buildMuteList, the destructive path', () => {
  it('CARRIES FORWARD tags it does not understand', () => {
    // THE test.
    const previous = event({
      tags: [['p', ALICE], ['title', 'my mutes'], ['alt', 'a mute list'], ['from-a-newer-nip', 'x']],
    })

    const template = buildMuteList({ items: [{ type: 'p', value: BOB }], previous })

    expect(template.tags).toContainEqual(['title', 'my mutes'])
    expect(template.tags).toContainEqual(['alt', 'a mute list'])
    expect(template.tags).toContainEqual(['from-a-newer-nip', 'x'])
  })

  it('preserves muted words and hashtags this app never touches', () => {
    // The app acts on `p` and nothing else.
    const previous = event({ tags: [['word', 'airdrop'], ['t', 'spam'], ['e', '33'.repeat(32)]] })
    const entries = parseMuteList(previous)

    const template = buildMuteList({ items: [...entries, { type: 'p', value: BOB }], previous })

    expect(template.tags).toContainEqual(['word', 'airdrop'])
    expect(template.tags).toContainEqual(['t', 'spam'])
    expect(template.tags).toContainEqual(['e', '33'.repeat(32)])
    expect(template.tags).toContainEqual(['p', BOB])
  })

  it('is always newer than what it replaces', () => {
    // Same-second republication lets relays keep either copy, tie-broken by the lower id.
    const previous = event({ created_at: 5_000 })
    const template = buildMuteList({ items: [], previous, createdAt: 5_000 })
    expect(template.created_at).toBeGreaterThan(previous.created_at)
  })

  it('does not copy the old entries twice', () => {
    const previous = event({ tags: [['p', ALICE]] })
    const template = buildMuteList({ items: [{ type: 'p', value: ALICE }], previous })
    expect(template.tags.filter(tag => tag[0] === 'p')).toHaveLength(1)
  })
})

describe('public and private halves', () => {
  it('puts new entries in the private half', () => {
    // A public mute list is a signed, permanent, machine-readable enemies list.
    const next = toggleMute(EMPTY_MUTES, { type: 'p', value: ALICE })
    expect(next.privateItems).toHaveLength(1)
    expect(next.publicItems).toHaveLength(0)
  })

  it('leaves an existing public entry where it was found', () => {
    // Moving somebody's public mutes into ciphertext breaks them in every other client.
    const list: MuteList = { publicItems: [{ type: 'p', value: ALICE }], privateItems: [] }
    const next = toggleMute(list, { type: 'p', value: BOB })
    expect(next.publicItems).toEqual([{ type: 'p', value: ALICE }])
    expect(next.privateItems).toEqual([{ type: 'p', value: BOB }])
  })

  it('un-mutes from BOTH halves', () => {
    const list: MuteList = {
      publicItems: [{ type: 'p', value: ALICE }],
      privateItems: [{ type: 'p', value: ALICE }],
    }
    const next = toggleMute(list, { type: 'p', value: ALICE })
    expect(hasMute(next, { type: 'p', value: ALICE })).toBe(false)
  })

  it('round-trips the private half through its plaintext', () => {
    const items: MuteEntry[] = [
      { type: 'p', value: ALICE },
      { type: 'word', value: 'airdrop' },
    ]
    expect(parsePrivateMutes(privateMutesPlaintext(items))).toEqual(items)
  })

  it('survives unreadable private content rather than un-muting everyone', () => {
    expect(parsePrivateMutes('not json at all')).toEqual([])
    expect(parsePrivateMutes('{"not":"an array"}')).toEqual([])
  })
})

describe('mergeMutes, union, never subtraction', () => {
  it('keeps a local mute the relays have never heard of', () => {
    // Muted while signed out, then signed.
    const remote: MuteList = { publicItems: [{ type: 'p', value: ALICE }], privateItems: [] }
    const merged = mergeMutes(remote, [{ type: 'p', value: BOB }])

    expect(hasMute(merged, { type: 'p', value: ALICE })).toBe(true)
    expect(hasMute(merged, { type: 'p', value: BOB })).toBe(true)
  })

  it('never removes anything the local list lacks', () => {
    const remote: MuteList = {
      publicItems: [{ type: 'p', value: ALICE }],
      privateItems: [{ type: 'word', value: 'airdrop' }],
    }
    const merged = mergeMutes(remote, [])
    expect(mutedPubkeys(merged)).toContain(ALICE)
    expect(hasMute(merged, { type: 'word', value: 'airdrop' })).toBe(true)
  })

  it('does not duplicate an entry that is already on the remote list', () => {
    const remote: MuteList = { publicItems: [{ type: 'p', value: ALICE }], privateItems: [] }
    const merged = mergeMutes(remote, [{ type: 'p', value: ALICE }])
    expect(merged.publicItems.length + merged.privateItems.length).toBe(1)
    // And it stays PUBLIC, because that is the side it was found.
    expect(merged.publicItems).toHaveLength(1)
  })
})

describe('newestMuteList', () => {
  it('takes the newest', () => {
    const older = event({ created_at: 100, id: 'aa'.repeat(32) as Hex })
    const newer = event({ created_at: 200, id: 'bb'.repeat(32) as Hex })
    expect(newestMuteList([older, newer])?.id).toBe(newer.id)
  })

  it('breaks a same-second tie on the lower id, as NIP-01 says', () => {
    const a = event({ created_at: 100, id: 'aa'.repeat(32) as Hex })
    const b = event({ created_at: 100, id: 'bb'.repeat(32) as Hex })
    expect(newestMuteList([b, a])?.id).toBe(a.id)
  })

  it('ignores events of other kinds', () => {
    expect(newestMuteList([event({ kind: 3 })])).toBeUndefined()
  })
})

describe('mutedPubkeys', () => {
  it('returns accounts from both halves and nothing else', () => {
    const list: MuteList = {
      publicItems: [{ type: 'p', value: ALICE }, { type: 't', value: 'spam' }],
      privateItems: [{ type: 'p', value: BOB }, { type: 'word', value: 'airdrop' }],
    }
    expect(mutedPubkeys(list).sort()).toEqual([ALICE, BOB].sort())
  })
})
