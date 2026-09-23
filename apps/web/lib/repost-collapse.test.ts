import { describe, expect, it } from 'vitest'
import { KINDS, type NostrEvent } from '@nostrich/nostr'

import { collapseReposts } from './repost-collapse'

/** Ids must be real 64-character HEX. */
const hex = (seed: string): string => seed.repeat(64).slice(0, 64)

const note = (id: string, pubkey = hex('a')): NostrEvent => ({
  id: hex(id), pubkey, created_at: 1_000, kind: KINDS.shortNote, tags: [], content: 'hi', sig: '0'.repeat(128),
})

/** A kind-6 with the original embedded, as most clients publish. */
const repost = (id: string, of: NostrEvent, by: string): NostrEvent => ({
  id: hex(id), pubkey: by, created_at: 2_000, kind: KINDS.repost,
  tags: [['e', of.id]], content: JSON.stringify(of), sig: '0'.repeat(128),
})

/** A kind-6 with NO embedded note. */
const bareRepost = (id: string, ofId: string, by: string): NostrEvent => ({
  id: hex(id), pubkey: by, created_at: 2_000, kind: KINDS.repost,
  tags: [['e', hex(ofId)]], content: '', sig: '0'.repeat(128),
})

describe('collapseReposts', () => {
  it('keeps one row when two people repost the same note', () => {
    const original = note('1')
    const kept = collapseReposts([repost('2', original, hex('b')), repost('3', original, hex('c'))])
    expect(kept.map(e => e.id)).toEqual([hex('2')])
  })

  it('does the same for bare reposts, which carry no embedded note', () => {
    const kept = collapseReposts([bareRepost('2', '1', hex('b')), bareRepost('3', '1', hex('c'))])
    expect(kept.map(e => e.id)).toEqual([hex('2')])
  })

  it('prefers the original over a repost of it, whichever came first', () => {
    const original = note('1')
    const kept = collapseReposts([repost('2', original, hex('b')), original])
    expect(kept.map(e => e.id)).toEqual([hex('1')])
  })

  it('leaves a repost of a note that is NOT otherwise in the list', () => {
    const kept = collapseReposts([note('1'), repost('2', note('4'), hex('b'))])
    expect(kept.map(e => e.id)).toEqual([hex('1'), hex('2')])
  })

  it('never merges two different notes', () => {
    expect(collapseReposts([note('1'), note('4')]).map(e => e.id)).toEqual([hex('1'), hex('4')])
  })

  it('leaves the input alone', () => {
    const input = [note('1'), note('1')]
    collapseReposts(input)
    expect(input).toHaveLength(2)
  })
})
