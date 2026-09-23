import { describe, expect, it } from 'vitest'

import {
  BURST_LIMIT,
  MAX_HASHTAGS,
  MAX_REPLY_PTAGS,
  MAX_ROOT_PTAGS,
  burstRate,
  distinctHashtags,
  isBursting,
  isHellthread,
  isRootNote,
  isTagStuffed,
  isTagStuffingAccount,
} from './spam-shape'
import type { NostrEvent } from './types'

/** Shape rules. */

const key = (i: number): string => (i + 16).toString(16).padStart(2, '0').repeat(32)

function note(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '11'.repeat(32),
    pubkey: key(0),
    created_at: 1_800_000_000,
    kind: 1,
    tags: [],
    content: 'hello',
    sig: '0'.repeat(128),
    ...overrides,
  }
}

describe('distinctHashtags', () => {
  it('counts each tag once however the client cased it', () => {
    // Several clients publish every hashtag twice, once as typed and once lowercased.
    const doubled = note({
      tags: [['t', 'Bitcoin'], ['t', 'bitcoin'], ['t', 'Nostr'], ['t', 'nostr']],
    })
    expect(distinctHashtags(doubled)).toBe(2)
  })

  it('ignores blank tags', () => {
    expect(distinctHashtags(note({ tags: [['t', '  '], ['t', 'nostr']] }))).toBe(1)
  })
})

describe('isTagStuffed', () => {
  it('leaves an ordinary post alone', () => {
    const ordinary = note({
      tags: Array.from({ length: MAX_HASHTAGS }, (_, i) => ['t', `tag${i}`]),
    })
    expect(isTagStuffed(ordinary)).toBe(false)
  })

  it('flags one past the cap', () => {
    const stuffed = note({
      tags: Array.from({ length: MAX_HASHTAGS + 1 }, (_, i) => ['t', `tag${i}`]),
    })
    expect(isTagStuffed(stuffed)).toBe(true)
  })

  it('separates the note judgement from the account judgement', () => {
    const eight = note({ tags: Array.from({ length: 8 }, (_, i) => ['t', `tag${i}`]) })
    // Annoying, not mechanical.
    expect(isTagStuffed(eight)).toBe(true)
    expect(isTagStuffingAccount(eight)).toBe(false)
  })

  it('condemns the account only at a count no person types', () => {
    const machine = note({ tags: Array.from({ length: 40 }, (_, i) => ['t', `tag${i}`]) })
    expect(isTagStuffingAccount(machine)).toBe(true)
  })
})

describe('isHellthread', () => {
  it('flags a root note that addresses a crowd', () => {
    const broadcast = note({
      tags: Array.from({ length: MAX_ROOT_PTAGS }, (_, i) => ['p', key(i)]),
    })
    expect(isRootNote(broadcast)).toBe(true)
    expect(isHellthread(broadcast)).toBe(true)
  })

  it('gives a reply far more room, because it inherits participants', () => {
    // A group conversation accumulates every prior participant by design.
    const busyReply = note({
      tags: [
        ['e', '22'.repeat(32)],
        ...Array.from({ length: MAX_ROOT_PTAGS + 5 }, (_, i) => ['p', key(i)]),
      ],
    })
    expect(isRootNote(busyReply)).toBe(false)
    expect(isHellthread(busyReply)).toBe(false)
  })

  it('still catches an actual hellthread reply', () => {
    const hellthread = note({
      tags: [
        ['e', '22'.repeat(32)],
        ...Array.from({ length: MAX_REPLY_PTAGS }, (_, i) => ['p', key(i)]),
      ],
    })
    expect(isHellthread(hellthread)).toBe(true)
  })

  it('counts distinct accounts, not repeated tags', () => {
    const repeated = note({
      tags: Array.from({ length: 40 }, () => ['p', key(1)]),
    })
    expect(isHellthread(repeated)).toBe(false)
  })
})

describe('burstRate', () => {
  const AUTHOR = key(0)

  it('is zero for someone who posted nothing', () => {
    expect(burstRate([note({ pubkey: key(1) })], AUTHOR)).toBe(0)
  })

  it('counts the densest window, not the total', () => {
    // Three notes close together and one far away is a burst of three, not of four.
    const events = [
      note({ pubkey: AUTHOR, created_at: 1000 }),
      note({ pubkey: AUTHOR, created_at: 1060 }),
      note({ pubkey: AUTHOR, created_at: 1120 }),
      note({ pubkey: AUTHOR, created_at: 900_000 }),
    ]
    expect(burstRate(events, AUTHOR)).toBe(3)
  })

  it('does not blame someone for posting steadily all day', () => {
    // One note every twenty minutes for twelve hours: prolific, not mechanical.
    const events = Array.from({ length: 36 }, (_, i) =>
      note({ pubkey: AUTHOR, created_at: 1000 + i * 20 * 60 }),
    )
    expect(isBursting(events, AUTHOR)).toBe(false)
  })

  it('flags a machine cadence', () => {
    const events = Array.from({ length: BURST_LIMIT }, (_, i) =>
      note({ pubkey: AUTHOR, created_at: 1000 + i * 30 }),
    )
    expect(isBursting(events, AUTHOR)).toBe(true)
  })

  it('is unmoved by other people posting', () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      note({ pubkey: key(i + 1), created_at: 1000 + i }),
    )
    expect(burstRate(events, AUTHOR)).toBe(0)
  })
})
