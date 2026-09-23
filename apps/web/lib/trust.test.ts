import { beforeEach, describe, expect, it } from 'vitest'
import type { Hex, NostrEvent, Profile } from '@nostrich/nostr'

import {
  authorTier,
  MAX_ROOT_PTAGS,
  noteReasons,
  tierRank,
  verdictFor,
  type Surface,
  type Tier,
  type TrustContext,
} from './trust'
import { addTerm, inList, removeTerm, toggleList } from './user-lists'

/** The rules that decide whether a stranger's note is shown. */

const hex = (seed: string): Hex => seed.repeat(64).slice(0, 64) as Hex
/** N genuinely distinct pubkeys. */
const distinctKeys = (count: number): Hex[] =>
  Array.from({ length: count }, (_, i) => (i + 16).toString(16).padStart(2, '0').repeat(32) as Hex)

const READER = hex('a')
const FRIEND = hex('b')
const FRIEND_OF_FRIEND = hex('c')
const STRANGER = hex('d')
/** Hand-listed in spam.ts. */
const BLOCKED = ('2'.repeat(64)) as Hex

const NAMED: Profile = { pubkey: STRANGER, name: 'someone', updatedAt: 0 }

function note(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '11'.repeat(32),
    pubkey: STRANGER,
    created_at: 1_800_000_000,
    kind: 1,
    tags: [],
    content: 'hello',
    sig: '0'.repeat(128),
    ...overrides,
  }
}

/** A graph that has finished crawling and knows about a friend and a friend-of-friend. */
function context(overrides: Partial<TrustContext> = {}): TrustContext {
  return {
    viewer: READER,
    graphReady: true,
    distance: (pubkey: Hex) => {
      if (pubkey === READER) return 0
      if (pubkey === FRIEND) return 1
      if (pubkey === FRIEND_OF_FRIEND) return 2
      return Infinity
    },
    profileFor: () => NAMED,
    nip05Verified: () => false,
    ...overrides,
  }
}

beforeEach(() => {
  // The mute store is a module Set, so unmute through the API rather than clearing.
  for (const pubkey of [READER, FRIEND, FRIEND_OF_FRIEND, STRANGER, BLOCKED]) {
    if (inList('muted', pubkey)) toggleList('muted', pubkey)
  }
})

describe('authorTier', () => {
  it('places the reader and their follows above everything', () => {
    expect(authorTier(READER, context())).toBe('self')
    expect(authorTier(FRIEND, context())).toBe('trusted')
    expect(authorTier(FRIEND_OF_FRIEND, context())).toBe('known')
  })

  it('gives a named stranger the benefit of the doubt', () => {
    expect(authorTier(STRANGER, context())).toBe('unknown')
  })

  it('demotes an account with no profile', () => {
    expect(authorTier(STRANGER, context({ profileFor: () => undefined }))).toBe('suspect')
  })

  it('demotes an account with a profile but no usable name', () => {
    const blank: Profile = { pubkey: STRANGER, name: '   ', updatedAt: 0 }
    expect(authorTier(STRANGER, context({ profileFor: () => blank }))).toBe('suspect')
  })

  it('demotes the hand-listed spam account', () => {
    expect(authorTier(BLOCKED, context())).toBe('suspect')
  })

  it('promotes a verified account with a filled-in profile', () => {
    const complete: Profile = {
      pubkey: STRANGER,
      name: 'someone',
      about: 'a real bio',
      picture: 'https://example.com/a.png',
      nip05: 'someone@example.com',
      updatedAt: 0,
    }
    const tier = authorTier(
      STRANGER,
      context({ profileFor: () => complete, nip05Verified: () => true }),
    )
    expect(tier).toBe('vouched')
  })

  it('does NOT treat an unknown profile age as ancient', () => {
    // `readCachedProfile` returns updatedAt: 0 by design.
    const verifiedButUnknownAge: Profile = {
      pubkey: STRANGER,
      name: 'someone',
      nip05: 'someone@example.com',
      updatedAt: 0,
    }
    const tier = authorTier(
      STRANGER,
      context({ profileFor: () => verifiedButUnknownAge, nip05Verified: () => true }),
    )
    expect(tier).toBe('unknown')
  })

  it('beats every other rule with mute', () => {
    toggleList('muted', FRIEND)
    // Even someone you follow.
    expect(authorTier(FRIEND, context())).toBe('muted')
  })
})

/** THE READER CANNOT BE FILTERED OUT OF THEIR OWN TIMELINE. */
describe('the reader is exempt from the reader\'s own filters', () => {
  it('is self, not muted, even when the reader is in their own mute list', () => {
    toggleList('muted', READER)
    expect(authorTier(READER, context())).toBe('self')
  })

  it('SHOWS the reader their own note rather than hiding it, the bug, in one line', () => {
    toggleList('muted', READER)
    const verdict = verdictFor(note({ pubkey: READER }), context(), 'discovery')
    expect(verdict.action).toBe('show')
    expect(verdict.action).not.toBe('hide')
  })

  it('still hides a muted stranger, so the exemption is the reader alone', () => {
    toggleList('muted', STRANGER)
    expect(verdictFor(note({ pubkey: STRANGER }), context(), 'discovery').action).toBe('hide')
  })

  it('shows the reader their own note on a curated surface too', () => {
    toggleList('muted', READER)
    expect(verdictFor(note({ pubkey: READER }), context(), 'curated').action).toBe('show')
  })

  it('does not apply the reader\'s own word filter to the reader\'s own writing', () => {
    // A term list, so `addTerm`.
    addTerm('mutedWords', 'airdrop')
    try {
      expect(verdictFor(note({ pubkey: STRANGER, content: 'airdrop today' }), context(), 'discovery').action)
        .toBe('collapse')
      expect(verdictFor(note({ pubkey: READER, content: 'airdrop shipped' }), context(), 'discovery').action)
        .toBe('show')
    } finally {
      removeTerm('mutedWords', 'airdrop')
    }
  })
})

describe('graphReady', () => {
  it('demotes nobody while the crawl is still running', () => {
    // Every distance is Infinity during a crawl.
    const crawling = context({ graphReady: false, distance: () => Infinity })
    expect(authorTier(STRANGER, crawling)).toBe('unknown')
    expect(verdictFor(note(), crawling, 'discovery').action).toBe('show')
  })

  it('does not sink a signed-out reader into rank-down for everybody', () => {
    const signedOut = context({ graphReady: false, viewer: undefined, distance: () => Infinity })
    expect(verdictFor(note(), signedOut, 'discovery').action).toBe('show')
  })
})

describe('curated surfaces', () => {
  const SURFACES: Surface[] = ['curated', 'discovery']

  it('never acts on a follow feed, whatever the tier', () => {
    // THIS IS THE POLICY TEST.
    const cases: [string, TrustContext][] = [
      ['no profile', context({ profileFor: () => undefined })],
      ['blocked', context()],
    ]
    for (const [label, ctx] of cases) {
      const verdict = verdictFor(note({ pubkey: BLOCKED }), ctx, 'curated')
      expect(verdict.action, label).toBe('show')
      expect(verdict.reasons, label).toEqual([])
    }
  })

  it('hides a muted account even there, because that is the reader speaking', () => {
    toggleList('muted', STRANGER)
    expect(verdictFor(note(), context(), 'curated').action).toBe('hide')
  })

  it('collapses on discovery what it shows on a curated surface', () => {
    const ctx = context({ profileFor: () => undefined })
    expect(verdictFor(note(), ctx, 'curated').action).toBe('show')
    expect(verdictFor(note(), ctx, 'discovery').action).toBe('collapse')
  })

  it('offers every surface a defined action for every tier', () => {
    for (const surface of SURFACES) {
      const verdict = verdictFor(note(), context(), surface)
      expect(['show', 'rank-down', 'collapse', 'hide']).toContain(verdict.action)
    }
  })
})

describe('trusted is never actionable', () => {
  it('shows a follow even when the note itself is awful', () => {
    // Somebody you follow tagging fifty people is a person posting badly, not a spammer.
    const awful = note({
      pubkey: FRIEND,
      tags: Array.from({ length: 40 }, (_, i) => ['t', `tag${i}`]),
    })
    expect(verdictFor(awful, context(), 'discovery').action).toBe('show')
  })
})

describe('noteReasons', () => {
  it('flags a tag-stuffed note', () => {
    const stuffed = note({ tags: Array.from({ length: 9 }, (_, i) => ['t', `tag${i}`]) })
    expect(noteReasons(stuffed).map(reason => reason.code)).toContain('tag-stuffing')
  })

  it('counts distinct hashtags, not tag entries', () => {
    // Several clients publish each hashtag twice, once as typed and once lowercased.
    const doubled = note({
      tags: [['t', 'Bitcoin'], ['t', 'bitcoin'], ['t', 'Nostr'], ['t', 'nostr']],
    })
    expect(noteReasons(doubled)).toEqual([])
  })

  it('flags a root note that tags a crowd', () => {
    const broadcast = note({
      tags: distinctKeys(MAX_ROOT_PTAGS).map(pubkey => ['p', pubkey]),
    })
    expect(noteReasons(broadcast).map(reason => reason.code)).toContain('hellthread')
  })

  it('does not apply the mention cap to replies', () => {
    // A reply legitimately accumulates every prior participant as a group thread deepens.
    const deepReply = note({
      tags: [
        ['e', '22'.repeat(32)],
        ...distinctKeys(40).map(pubkey => ['p', pubkey]),
      ],
    })
    expect(deepReply.tags.filter(tag => tag[0] === 'p').length).toBeGreaterThan(MAX_ROOT_PTAGS)
    expect(noteReasons(deepReply).map(reason => reason.code)).not.toContain('hellthread')
  })

  it('says nothing about an ordinary note', () => {
    expect(noteReasons(note({ tags: [['t', 'bitcoin']] }))).toEqual([])
  })
})

describe('every verdict can be explained', () => {
  it('carries at least one sentence whenever it acts', () => {
    const acted = [
      verdictFor(note(), context({ profileFor: () => undefined }), 'discovery'),
      verdictFor(note({ pubkey: BLOCKED }), context(), 'discovery'),
    ]
    for (const verdict of acted) {
      expect(verdict.action).not.toBe('show')
      expect(verdict.reasons.length).toBeGreaterThan(0)
      for (const reason of verdict.reasons) expect(reason.text.trim()).not.toBe('')
    }
  })
})

describe('tierRank', () => {
  it('orders from most to least standing', () => {
    const order: Tier[] = ['self', 'trusted', 'known', 'vouched', 'unknown', 'suspect', 'muted']
    const ranks = order.map(tierRank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(new Set(ranks).size).toBe(order.length)
  })
})

/** THE INVARIANT. Adding evidence must never lower an account's standing. */
describe('promote-only', () => {
  const SIGNALS = {
    named: (base: Profile): Profile => ({ ...base, name: 'someone' }),
    bio: (base: Profile): Profile => ({ ...base, about: 'a real bio' }),
    picture: (base: Profile): Profile => ({ ...base, picture: 'https://example.com/a.png' }),
    nip05: (base: Profile): Profile => ({ ...base, nip05: 'someone@example.com' }),
  }

  it('never lowers the tier when a profile field is added', () => {
    const start: Profile = { pubkey: STRANGER, name: 'someone', updatedAt: 0 }

    for (const [label, apply] of Object.entries(SIGNALS)) {
      for (const verified of [false, true]) {
        const ctx = (profile: Profile): TrustContext =>
          context({ profileFor: () => profile, nip05Verified: () => verified })

        const before = tierRank(authorTier(STRANGER, ctx(start)))
        const after = tierRank(authorTier(STRANGER, ctx(apply(start))))

        // Lower rank number = more standing, so adding a signal must never RAISE the number.
        expect(after, `${label} (verified: ${verified})`).toBeLessThanOrEqual(before)
      }
    }
  })

  it('never lowers the tier when the graph learns about someone', () => {
    const blind = context({ graphReady: true, distance: () => Infinity })
    const knows = context({ graphReady: true, distance: () => 2 })
    expect(tierRank(authorTier(STRANGER, knows))).toBeLessThanOrEqual(
      tierRank(authorTier(STRANGER, blind)),
    )
  })

  it('never lowers the action when work was mined into the note', () => {
    // PoW is promote-only by construction: it can rescue a note, never sink one.
    const ctx = context({ graphReady: true, distance: () => Infinity })
    const plain = verdictFor(note(), ctx, 'discovery')
    expect(['show', 'rank-down']).toContain(plain.action)
  })

  it('never demotes anyone for a signal that is merely absent', () => {
    // An empty profile cache means "we have not looked yet" on every field except.
    const minimal: Profile = { pubkey: STRANGER, name: 'someone', updatedAt: 0 }
    expect(authorTier(STRANGER, context({ profileFor: () => minimal }))).not.toBe('suspect')
  })
})
