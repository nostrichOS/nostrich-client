import { describe, expect, it } from 'vitest'

import { advertisedHosts, manipulatedEngagement, selfPromotingReply } from './abuse'

/** The shape of bought engagement, pinned against the note it was measured. */
const counts = (replies: number, likes = 0, reposts = 0, zapSats = 0) => ({
  replies,
  likes,
  reposts,
  zapSats,
})

describe('manipulatedEngagement', () => {
  it('catches the measured note', () => {
    expect(manipulatedEngagement(counts(15))).toBe('replies-only')
  })

  it('clears a note with a single like beside its replies', () => {
    // A like is the cheapest action there.
    expect(manipulatedEngagement(counts(15, 1))).toBeUndefined()
    expect(manipulatedEngagement(counts(15, 0, 1))).toBeUndefined()
    expect(manipulatedEngagement(counts(15, 0, 0, 21))).toBeUndefined()
  })

  it('never judges a note with few replies', () => {
    // A new note with two replies and no likes yet is the ordinary state of a new note.
    expect(manipulatedEngagement(counts(4))).toBeUndefined()
    expect(manipulatedEngagement(counts(1))).toBeUndefined()
    expect(manipulatedEngagement(counts(0))).toBeUndefined()
  })

  it('clears an ordinary popular note', () => {
    expect(manipulatedEngagement(counts(40, 300, 25, 12_000))).toBeUndefined()
  })

  it('has no opinion when the counts are unknown', () => {
    // Absent counts mean "not fetched", never "nothing happened".
    expect(manipulatedEngagement(undefined)).toBeUndefined()
  })
})

/** The mirror of the measured reply farm: reactions are the cheapest event a minted. */
describe('reaction floods', () => {
  it('catches a pile of reactions and nothing else', () => {
    expect(manipulatedEngagement(counts(0, 10))).toBe('reactions-only')
    expect(manipulatedEngagement(counts(0, 500))).toBe('reactions-only')
  })

  it('clears a note with anything else beside its reactions', () => {
    expect(manipulatedEngagement(counts(1, 40))).toBeUndefined()
    expect(manipulatedEngagement(counts(0, 40, 1))).toBeUndefined()
    expect(manipulatedEngagement(counts(0, 40, 0, 21))).toBeUndefined()
  })

  it('never judges a note with few reactions', () => {
    // Six likes and no replies yet is the ordinary first hour of a decent note.
    expect(manipulatedEngagement(counts(0, 9))).toBeUndefined()
    expect(manipulatedEngagement(counts(0, 0))).toBeUndefined()
  })
})

describe('new-account replies', () => {
  /** "If an nsec only replies to a certain account that's a game." A farm mints keys. */
  const established = (known: string[]) => (pubkey: string) => known.includes(pubkey)
  const keys = (n: number, prefix = 'new') => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

  it('catches a note replied to entirely by fresh keys', () => {
    // Likes present, so `replies-only` does not fire.
    expect(
      manipulatedEngagement(counts(12, 3), { authors: keys(12), established: established([]) }),
    ).toBe('new-account-replies')
  })

  it('is not fooled by seeding the ring with one real account', () => {
    const authors = [...keys(11), 'real0']
    expect(
      manipulatedEngagement(counts(12, 3), { authors, established: established(['real0']) }),
    ).toBe('new-account-replies')
  })

  it('clears a real conversation that picked up a few new readers', () => {
    const authors = [...keys(3), ...keys(9, 'real')]
    expect(
      manipulatedEngagement(counts(12, 3), { authors, established: established(keys(9, 'real')) }),
    ).toBeUndefined()
  })

  it('never judges a note with few replies', () => {
    // Three replies from three new accounts is how a new account's first conversation.
    expect(
      manipulatedEngagement(counts(3, 2), { authors: keys(3), established: established([]) }),
    ).toBeUndefined()
  })

  it('is skipped entirely when the caller cannot afford the repliers', () => {
    expect(manipulatedEngagement(counts(12, 3))).toBeUndefined()
  })
})

describe('selfPromotingReply', () => {
  /** Six accounts all advertising `example-campaign.test`, one of them posting 96 notes. */
  const reply = (content: string) => ({ tags: [['e', 'x'.repeat(64)]], content })
  const root = (content: string) => ({ tags: [], content })

  it('catches a reply linking to the author own site', () => {
    expect(selfPromotingReply(reply('Great point, more on this https://example-campaign.test/housing'), advertisedHosts({ website: 'https://example-campaign.test' }))).toBe(true)
  })

  it('ignores www and scheme differences', () => {
    expect(selfPromotingReply(reply('see http://www.example-campaign.test/x'), advertisedHosts({ website: 'https://example-campaign.test' }))).toBe(true)
  })

  it('leaves ROOT notes alone', () => {
    // Publishing your own work to your own followers is what a website field.
    expect(selfPromotingReply(root('New piece: https://example-campaign.test/housing'), advertisedHosts({ website: 'https://example-campaign.test' }))).toBe(false)
  })

  it('leaves a reply linking somewhere else alone', () => {
    expect(selfPromotingReply(reply('this covers it https://bitcoinmagazine.com/x'), advertisedHosts({ website: 'https://example-campaign.test' }))).toBe(false)
  })

  it('has no opinion when the author advertises nothing', () => {
    expect(selfPromotingReply(reply('https://example-campaign.test/x'), advertisedHosts(undefined))).toBe(false)
    expect(selfPromotingReply(reply('https://example-campaign.test/x'), advertisedHosts({ website: 'not a url' }))).toBe(false)
  })
})

describe('advertisedHosts', () => {
  /** The fleet stopped filling in `website` the week after the rule shipped. */
  const KATE = {
    about:
      'Sanctions & economic warfare analyst at the campaign. Covering OFAC actions, evasion ' +
      'networks, and financial statecraft. example-campaign.test',
  }

  it('reads the domain out of a bio that has no website field', () => {
    expect(advertisedHosts(KATE)).toContain('example-campaign.test')
  })

  it('catches the reply that was slipping through', () => {
    const drop = {
      tags: [['e', 'x'.repeat(64)]],
      content: 'BIP-110 signalling is a useful gauge. https://example-campaign.test/articles/bip110',
    }
    expect(selfPromotingReply(drop, advertisedHosts(KATE))).toBe(true)
  })

  it('still reads the website field, and both at once', () => {
    expect(advertisedHosts({ website: 'https://example-campaign.test', about: 'also at example.org' }))
      .toEqual(expect.arrayContaining(['example-campaign.test', 'example.org']))
  })

  it('normalises www and case, so one domain is one entry', () => {
    expect(advertisedHosts({ website: 'https://WWW.Example-Campaign.Test' })).toEqual(['example-campaign.test'])
    expect(advertisedHosts({ about: 'WWW.Example-Campaign.Test' })).toEqual(['example-campaign.test'])
  })

  it('does NOT read banner, where an ordinary reader keeps a media host', () => {
    // Most banners are on nostr.build or a Blossom server, and notes are full of image.
    expect(advertisedHosts({ banner: 'https://nostr.build/x.png' } as never)).toEqual([])
  })

  it('has nothing to say about a profile that advertises nothing', () => {
    expect(advertisedHosts({})).toEqual([])
    expect(advertisedHosts(undefined)).toEqual([])
    expect(advertisedHosts({ about: 'just a person who likes bitcoin' })).toEqual([])
  })
})
