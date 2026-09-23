import { describe, expect, it } from 'vitest'
import type { Hex, NostrEvent } from '@nostrich/nostr'

import {
  hasAdultName,
  hasSuppressedName,
  isAdultName,
  isSuppressedName,
  isBlockedFromDiscovery,
  isPromotable,
  isPromotableTag,
  isSuppressed,
  isTagSpam,
  linksToPhishingDomain,
  MAX_HASHTAGS,
  rejectEvent,
  bodySignature,
} from './spam'

/** The synthetic entry seeded in the blocklist. */
const NULPUNT = ('2'.repeat(64)) as Hex
const ORDINARY = 'aa'.repeat(32) as Hex
const AIRDROP = ('2'.repeat(64)) as Hex

function note(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '11'.repeat(32),
    pubkey: ORDINARY,
    created_at: 1_800_000_000,
    kind: 1,
    tags: [],
    content: 'hello',
    sig: '0'.repeat(128),
    ...overrides,
  }
}

/** The hand-maintained list catches what the shape heuristics cannot: an account. */
describe('the discovery blocklist', () => {
  it('drops a blocked account whose note has nothing suspicious in it', () => {
    const bland = note({ pubkey: NULPUNT, content: 'hi everyone', tags: [] })
    // Nothing about this note's SHAPE is spam.
    expect(bland.tags).toHaveLength(0)
    expect(isTagSpam(bland)).toBe(true)
  })

  it('reports membership separately from the tag-stuffing verdict', () => {
    expect(isBlockedFromDiscovery(NULPUNT)).toBe(true)
    expect(isBlockedFromDiscovery(ORDINARY)).toBe(false)
  })

  /** The phishing entry, and the reason the hand-maintained list has to exist at all. */
  it('catches an account no shape rule can see', () => {
    const bait = note({
      pubkey: AIRDROP,
      content: "🛰 Airdrop spot is confirmed, Season 1 has begun. You're eligible. https://example-phishing.test/",
      tags: [
        ['p', 'a'.repeat(64)],
        ['p', 'b'.repeat(64)],
        ['p', 'c'.repeat(64)],
        ['p', 'd'.repeat(64)],
        ['p', 'e'.repeat(64)],
      ],
    })
    expect(isBlockedFromDiscovery(AIRDROP)).toBe(true)
    // Five mentions is a conversation, not a broadcast.
    expect(isTagSpam(note({ ...bait, pubkey: ORDINARY }))).toBe(false)
  })

  /** A LISTED ACCOUNT WHOSE NOTES HAVE NO OBJECTIONABLE SHAPE. */
  it('blocks a listed key on a root note, which no shape rule reaches', () => {
    expect(isBlockedFromDiscovery(NULPUNT)).toBe(true)
    const promo = note({ pubkey: NULPUNT, content: 'A perfectly ordinary sentence.', tags: [] })
    expect(isTagSpam(note({ ...promo, pubkey: ORDINARY }))).toBe(false)
  })

  it('suppresses a listed key on a reply, where the method IS the reply', () => {
    // Suppression rather than discovery-blocking, because a rule scoped to surfaces.
    const suppressedKey = ('3'.repeat(64)) as Hex
    const blockedKey = ('2'.repeat(64)) as Hex
    expect(rejectEvent(note({ pubkey: suppressedKey, kind: 1, tags: [['e', 'f'.repeat(64)]] }))).toBe(true)
    expect(isBlockedFromDiscovery(blockedKey)).toBe(true)
    // And the notes themselves are shapeless.
    expect(isTagSpam(note({ pubkey: ORDINARY, content: 'Hi, your kindness across Nostr…', tags: [['p', 'a'.repeat(64)]] }))).toBe(false)
  })

  it('leaves everybody else alone', () => {
    expect(isTagSpam(note())).toBe(false)
    expect(isTagSpam(note({ tags: [['t', 'bitcoin'], ['t', 'nostr']] }))).toBe(false)
  })

  it('still catches tag stuffing from an unlisted account', () => {
    const stuffed = note({
      tags: Array.from({ length: MAX_HASHTAGS + 1 }, (_, i) => ['t', `tag${i}`]),
    })
    expect(isTagSpam(stuffed)).toBe(true)
  })
})

/** Never promoted, always reachable. */
describe('tags we never promote', () => {
  it('keeps adult tags out of lists we compose', () => {
    expect(isPromotableTag('nsfw')).toBe(false)
    expect(isPromotableTag('NSFW')).toBe(false)
    expect(isPromotableTag('porn')).toBe(false)
    expect(isPromotableTag('xxx')).toBe(false)
  })

  it('leaves every other tag alone', () => {
    expect(isPromotableTag('bitcoin')).toBe(true)
    expect(isPromotableTag('news')).toBe(true)
    // Deliberately short list: a tag that merely mentions the subject is not the subject.
    expect(isPromotableTag('nsfwart')).toBe(true)
    expect(isPromotableTag('adult')).toBe(true)
  })

  it('judges a note by the tags its author put on it', () => {
    expect(isPromotable(note({ tags: [['t', 'bitcoin']] }))).toBe(true)
    expect(isPromotable(note({ tags: [['t', 'bitcoin'], ['t', 'nsfw']] }))).toBe(false)
  })
})

/** Suppression: the tier with no way back for the reader. */
describe('suppressed accounts', () => {
  const REPLY_BOT = ('3'.repeat(64)) as Hex
  const FAKE_DAMUS = ('3'.repeat(64)) as Hex

  it('drops every event from a suppressed account, whatever the kind', () => {
    for (const kind of [1, 6, 7, 9735, 30023]) {
      expect(rejectEvent(note({ pubkey: REPLY_BOT, kind }))).toBe(true)
    }
    expect(isSuppressed(FAKE_DAMUS)).toBe(true)
  })

  /** Suppression implies blocking, so existing discovery checks stay correct on their own. */
  it('is a superset of the discovery blocklist', () => {
    expect(isBlockedFromDiscovery(REPLY_BOT)).toBe(true)
    expect(isBlockedFromDiscovery(FAKE_DAMUS)).toBe(true)
  })

  /** The invariant that keeps this defensible. */
  it('touches nobody else', () => {
    expect(isSuppressed(ORDINARY)).toBe(false)
    expect(isSuppressed(NULPUNT)).toBe(false)
    expect(rejectEvent(note())).toBe(false)
    // Even a note that LOOKS like the spam, from another key, is not suppressed.
    expect(rejectEvent(note({ content: "🏅 You're eligible, the Airdrop is ready." }))).toBe(false)
  })
})

/** The phishing-domain rule, and the exemption that keeps it defensible. */
describe('phishing domain links', () => {
  const STRANGER = 'dd'.repeat(32) as Hex
  const bait = (content: string) => note({ pubkey: STRANGER, content })

  it('suppresses the bait from an unverified author', () => {
    expect(rejectEvent(bait('claim now https://example-phishing.test/'))).toBe(true)
    expect(rejectEvent(bait('https://www.example-phishing.test/x?y=1'))).toBe(true)
    expect(rejectEvent(bait('https://claim.example-phishing.test/'))).toBe(true)
  })

  /** The whole point of the exemption. */
  it('lets a verified author warn people about it', () => {
    const warning = bait('do NOT click https://example-phishing.test/, it drains wallets')
    expect(rejectEvent(warning, () => true)).toBe(false)
  })

  it('leaves every other link alone', () => {
    expect(rejectEvent(bait('https://example-client.test/ is the real one'))).toBe(false)
    expect(rejectEvent(bait('https://example.com'))).toBe(false)
    expect(rejectEvent(bait('no links here'))).toBe(false)
  })

  /** Host matching, not substring. */
  it('matches the host and not the prose', () => {
    expect(rejectEvent(bait('beware of example-phishing.test, it is a scam'))).toBe(false)
    expect(rejectEvent(bait('https://notexample-phishing.test.example.com/'))).toBe(false)
  })

  it('is decided by the link, not the author, once the author is verified', () => {
    expect(linksToPhishingDomain(bait('https://example-phishing.test/'))).toBe(true)
    expect(linksToPhishingDomain(bait('https://example-client.test/'))).toBe(false)
  })
})

describe('isAdultName', () => {
  it('catches an account that says what it posts', () => {
    for (const name of [
      'Free Porn Videos',
      'p.o.r.n_star',
      'P0RN 4 U',
      'HentaiDaily',
      'nsfw_art',
      'OnlyFans Leaks',
      'your fav camgirl',
      'Nudes 🔥',
      'sexcam live',
      'Milf Hunter',
      'anal queen',
      'XXX',
      'Sex Tapes',
      'Adult Content 18+',
      '🔞 daily',
    ]) {
      expect(isAdultName(name), name).toBe(true)
    }
  })

  it('does not catch the words those fragments live inside', () => {
    // The Scunthorpe set.
    for (const name of [
      'Bitcoin Analyst',
      'analysis paralysis',
      'Sussex Bees',
      'Essex Photography',
      'Scunthorpe United',
      'Milford Sound',
      'Assistant to the chef',
      'classic cars',
      'Passionate about Nostr',
      'Cucumber Farmer',
      'Documentation',
      'Titan Rockets',
      'Constitution nerd',
      'Peacock feathers',
      'Torpedo Bay',
      'Shiitake grower',
      'Ashit Kumar',
      'Canal boat life',
      'Neurotic Coder',
      'Grasshopper',
    ]) {
      expect(isAdultName(name), name).toBe(false)
    }
  })

  it('reads display name, handle and NIP-05 alike', () => {
    expect(hasAdultName({ displayName: 'Porn Hub Clips' })).toBe(true)
    expect(hasAdultName({ name: 'nsfwbot' })).toBe(true)
    expect(hasAdultName({ nip05: 'hentai@example.com' })).toBe(true)
    expect(hasAdultName({ displayName: 'Alice', name: 'alice', nip05: 'alice@nostrich.org' })).toBe(
      false,
    )
    expect(hasAdultName(null)).toBe(false)
    expect(hasAdultName({})).toBe(false)
  })
})

describe('the name rule for a named operation', () => {
  it('matches a name carrying both words of the pair', () => {
    expect(isSuppressedName('Example_Placeholder')).toBe(true)
    expect(isSuppressedName('exampleplaceholder')).toBe(true)
  })

  it('sees through separators, case and decoration', () => {
    expect(isSuppressedName('example · placeholder 🍉')).toBe(true)
    expect(isSuppressedName('EXAMPLE_PLACEHOLDER')).toBe(true)
    expect(isSuppressedName('3x4mpl3.placeholder')).toBe(true)
    expect(isSuppressedName('Éxample, Pláceholder')).toBe(true)
  })

  it('needs BOTH words, which is what keeps it about one operation', () => {
    expect(isSuppressedName('example')).toBe(false)
    expect(isSuppressedName('placeholder')).toBe(false)
    expect(isSuppressedName('Placeholder Municipality')).toBe(false)
    expect(isSuppressedName('Example Khalil')).toBe(false)
    expect(isSuppressedName('')).toBe(false)
  })
})

describe('the name rule learns from the profile event itself', () => {
  const kind0 = (pubkey: string, body: Record<string, string>): NostrEvent =>
    ({ id: 'c'.repeat(64), pubkey, created_at: 1_787_000_000, kind: 0, tags: [], content: JSON.stringify(body), sig: '0'.repeat(128) }) as NostrEvent
  const kind1 = (pubkey: string): NostrEvent =>
    ({ id: 'd'.repeat(64), pubkey, created_at: 1_787_000_001, kind: 1, tags: [], content: 'reply', sig: '0'.repeat(128) }) as NostrEvent

  it('recognises a new key from its own kind-0, then drops everything it posts', () => {
    /* The bootstrap problem: the rule reads the author's name from the profile CACHE. */
    const pubkey = 'e'.repeat(64)
    // Nothing known yet: a note from this key, with no cached profile, passes.
    expect(rejectEvent(kind1(pubkey), () => false, () => undefined)).toBe(false)
    // The profile arrives and names itself.
    expect(rejectEvent(kind0(pubkey, { display_name: 'Example_Placeholder' }), () => false, () => undefined)).toBe(true)
    // From here on, every note from that key goes, cache or no cache.
    expect(rejectEvent(kind1(pubkey), () => false, () => undefined)).toBe(true)
  })

  it('leaves an ordinary profile and its notes alone', () => {
    const pubkey = 'f'.repeat(64)
    expect(rejectEvent(kind0(pubkey, { display_name: 'Placeholder Municipality' }), () => false, () => undefined)).toBe(false)
    expect(rejectEvent(kind1(pubkey), () => false, () => undefined)).toBe(false)
  })

  it('survives a kind-0 whose content is not JSON', () => {
    const pubkey = '1'.repeat(64)
    const broken = { ...kind0(pubkey, {}), content: 'not json at all' } as NostrEvent
    expect(() => rejectEvent(broken, () => false, () => undefined)).not.toThrow()
    expect(rejectEvent(broken, () => false, () => undefined)).toBe(false)
  })
})

describe('bodySignature', () => {
  /** Seven accounts, one newsletter, ten trending slots. */
  const NEWSLETTER = '📰 **In this week\'s issue:** '

  it('matches two long posts written from one template', () => {
    const tail =
      ' Read the whole thing on the site, subscribe for the weekly edition, forward it to a friend,'
      + ' and let us know what you thought of this one.'
    const a = `${NEWSLETTER}**Bitcoin Just Flashed a Signal No One Saw Coming**.${tail}`
    const b = `${NEWSLETTER}**The $400,000 Bet on Censorship Resistance**.${tail}`
    expect(bodySignature(a)).toBe(bodySignature(b))
    expect(bodySignature(a)).not.toBeUndefined()
  })

  it('has no opinion about short notes', () => {
    // Ten people saying "GM" are ten people.
    expect(bodySignature('GM')).toBeUndefined()
    expect(bodySignature('Bitcoin fixes this')).toBeUndefined()
  })

  it('separates two long posts that merely share a few words', () => {
    const tail =
      ' It took a while to get right and there was a lot of reading involved along the way, but'
      + ' the result was worth every minute of it in the end.'
    const a = `I have been thinking hard about lightning channels all week.${tail}`
    const b = `I have been reading up on lightning channels all week.${tail}`
    expect(bodySignature(a)).not.toBe(bodySignature(b))
  })

  it('ignores whitespace and case differences between copies', () => {
    const body = 'Bitcoin did something remarkable today and here is the long explanation of exactly why it matters to everyone.'
    const a = `${NEWSLETTER}${body}`
    const b = `${NEWSLETTER.toUpperCase()}\n\n${body.toUpperCase()}`
    expect(bodySignature(a)).toBe(bodySignature(b))
  })
})
