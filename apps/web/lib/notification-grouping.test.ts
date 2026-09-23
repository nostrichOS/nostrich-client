import { describe, expect, it } from 'vitest'
import type { Hex, NostrEvent } from '@nostrich/nostr'

import { actorSentence, groupNotifications } from './notification-grouping'
import type { NotificationItem } from './notifications'

/** What this file exists to stop coming back: a row reading "alice and 5 others liked. */

const NOTE = 'n'.repeat(64) as Hex
const OTHER = 'o'.repeat(64) as Hex

let seq = 0
function item(patch: Partial<NotificationItem> & { kind: NotificationItem['kind'] }): NotificationItem {
  seq += 1
  const id = String(seq).padStart(64, 'i')
  const event = {
    id,
    pubkey: 'a'.repeat(64),
    created_at: patch.createdAt ?? 1_700_000_000,
    kind: 7,
    tags: [] as string[][],
    content: patch.content ?? '',
    sig: '0'.repeat(128),
  } as unknown as NostrEvent
  return {
    id,
    actor: 'a'.repeat(64) as Hex,
    createdAt: 1_700_000_000,
    targetId: NOTE,
    event,
    ...patch,
  }
}

const reaction = (content: string, patch: Partial<NotificationItem> = {}) =>
  item({ kind: 'reaction', content, ...patch })

describe('groupNotifications: reactions', () => {
  it('separates likes from emoji on the same note', () => {
    const groups = groupNotifications([
      reaction('🤙'),
      reaction('🤙'),
      reaction('+'),
      reaction('💯'),
      reaction('+'),
    ])
    expect(groups).toHaveLength(2)
    const emoji = groups.find(g => g.flavour === 'emoji')
    const like = groups.find(g => g.flavour === 'like')
    expect(emoji?.items).toHaveLength(3)
    expect(like?.items).toHaveLength(2)
    expect(emoji?.key).not.toBe(like?.key)
  })

  /** NIP-25 says an empty content means `+`. */
  it('treats an empty content and a + as one group', () => {
    expect(groupNotifications([reaction(''), reaction('+')])).toHaveLength(1)
  })

  it('keeps every emoji in ONE reacted row rather than one row each', () => {
    const groups = groupNotifications([reaction('🤙'), reaction('💯'), reaction('🚀')])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.marks?.map(m => m.display)).toEqual(['🤙', '💯', '🚀'])
    expect(groups[0]?.moreMarks).toBeUndefined()
  })

  it('counts the emoji it could not show', () => {
    const groups = groupNotifications(
      ['🤙', '💯', '🚀', '👀', '😂'].map(emoji => reaction(emoji)),
    )
    expect(groups[0]?.marks).toHaveLength(3)
    expect(groups[0]?.moreMarks).toBe(2)
  })

  it('gives a dislike its own group rather than calling it a like', () => {
    const groups = groupNotifications([reaction('+'), reaction('-')])
    expect(groups).toHaveLength(2)
    expect(groups.some(g => g.flavour === 'dislike')).toBe(true)
  })

  it('never merges two different notes', () => {
    const groups = groupNotifications([reaction('🤙'), reaction('🤙', { targetId: OTHER })])
    expect(groups).toHaveLength(2)
  })

  it('carries the newest member’s time so recent activity floats the row up', () => {
    const groups = groupNotifications([
      reaction('🤙', { createdAt: 100 }),
      reaction('🤙', { createdAt: 900 }),
    ])
    expect(groups[0]?.createdAt).toBe(900)
  })
})

describe('groupNotifications: ordering', () => {
  /** The tie is reachable now that one note yields two rows. */
  it('is stable when two groups share a timestamp', () => {
    const build = () => [
      reaction('+', { createdAt: 500 }),
      reaction('🤙', { createdAt: 500 }),
    ]
    const forwards = groupNotifications(build()).map(g => g.key)
    const backwards = groupNotifications([...build()].reverse()).map(g => g.key)
    expect(forwards).toEqual(backwards)
  })

  it('sorts newest first', () => {
    const groups = groupNotifications([
      reaction('+', { createdAt: 100 }),
      reaction('🤙', { createdAt: 900 }),
    ])
    expect(groups.map(g => g.createdAt)).toEqual([900, 100])
  })
})

describe('groupNotifications: the kinds it must not touch', () => {
  it('leaves reposts, zaps and bookmarks keyed by the note alone', () => {
    for (const kind of ['repost', 'zap', 'bookmark'] as const) {
      const groups = groupNotifications([item({ kind }), item({ kind })])
      expect(groups).toHaveLength(1)
      expect(groups[0]?.flavour).toBeUndefined()
    }
  })

  it('keeps a repost and a reaction on one note apart', () => {
    expect(groupNotifications([item({ kind: 'repost' }), reaction('🤙')])).toHaveLength(2)
  })

  it('never collapses the kinds that carry words', () => {
    for (const kind of ['reply', 'mention', 'quote'] as const) {
      expect(groupNotifications([item({ kind }), item({ kind })])).toHaveLength(2)
    }
  })

  /** Seconds for a local wall-clock time, so these tests read as the reader's own clock. */
  const at = (y: number, m: number, d: number, h: number, min = 0): number =>
    Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000)

  it('groups follows from one day together and splits the next', () => {
    const groups = groupNotifications([
      item({ kind: 'follow', createdAt: at(2026, 8, 29, 9), targetId: undefined }),
      item({ kind: 'follow', createdAt: at(2026, 8, 29, 17), targetId: undefined }),
      item({ kind: 'follow', createdAt: at(2026, 8, 30, 6), targetId: undefined }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('does not split an evening down the middle', () => {
    /* The reported bug. */
    const groups = groupNotifications([
      item({ kind: 'follow', createdAt: at(2026, 8, 29, 19), targetId: undefined }),
      item({ kind: 'follow', createdAt: at(2026, 8, 29, 21, 30), targetId: undefined }),
      item({ kind: 'follow', createdAt: at(2026, 8, 29, 23, 45), targetId: undefined }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.items).toHaveLength(3)
  })

  it('keeps the same calendar day in different years apart', () => {
    const groups = groupNotifications([
      item({ kind: 'follow', createdAt: at(2025, 8, 30, 12), targetId: undefined }),
      item({ kind: 'follow', createdAt: at(2026, 8, 30, 12), targetId: undefined }),
    ])
    expect(groups).toHaveLength(2)
  })
})

describe('actorSentence', () => {
  it('names one, names two, counts the rest', () => {
    expect(actorSentence(['alice'], 1)).toBe('alice')
    expect(actorSentence(['alice', 'bob'], 2)).toBe('alice and bob')
    expect(actorSentence(['alice', 'bob'], 3)).toBe('alice and 2 others')
    expect(actorSentence(['alice', 'bob'], 1235)).toBe('alice and 1,234 others')
  })
})

/** AN UNCONFIRMED ZAP MUST NOT DISAPPEAR INTO A TOTAL. */
describe('an unconfirmed zap in a group', () => {
  const NOTE = 'n'.repeat(64)

  function zap(id: string, actor: string, sats: number, unsettled?: boolean): NotificationItem {
    return {
      id,
      kind: 'zap',
      actor: actor.repeat(64).slice(0, 64),
      createdAt: 1_000,
      targetId: NOTE,
      amountSats: sats,
      ...(unsettled === true ? { unsettled: true } : {}),
      event: { id, pubkey: 'z'.repeat(64), created_at: 1_000, kind: 9735, tags: [], content: '', sig: '0'.repeat(128) },
    }
  }

  it('marks the group when any member is unconfirmed', () => {
    const groups = groupNotifications([zap('a', 'a', 21), zap('b', 'b', 210, true)])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.totalSats).toBe(231)
    expect(groups[0]?.unsettled).toBe(true)
  })

  it('leaves a group of confirmed zaps unmarked', () => {
    const groups = groupNotifications([zap('a', 'a', 21), zap('b', 'b', 21)])
    expect(groups[0]?.totalSats).toBe(42)
    expect(groups[0]?.unsettled).toBeUndefined()
  })

  it('marks a group whose only member is unconfirmed', () => {
    const groups = groupNotifications([zap('a', 'a', 21, true)])
    expect(groups[0]?.unsettled).toBe(true)
  })
})
