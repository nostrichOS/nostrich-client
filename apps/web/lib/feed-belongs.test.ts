import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import { belongsInSource, holdsArrivals, keepsReplies, withSelf, type FeedSource } from './feed'

/** Which feed a freshly published note may appear. */

const ME = 'a'.repeat(64)
const THEM = 'b'.repeat(64)

function note(pubkey: string, tags: string[][] = []): NostrEvent {
  return { id: 'n'.repeat(64), pubkey, created_at: 1_000, kind: 1, tags, content: 'hi', sig: '0'.repeat(128) }
}

describe('belongsInSource', () => {
  it("keeps my note off someone else's profile", () => {
    const theirProfile: FeedSource = { kind: 'authors', authors: [THEM] }
    expect(belongsInSource(theirProfile, note(ME))).toBe(false)
  })

  it('puts my note on my own profile', () => {
    expect(belongsInSource({ kind: 'authors', authors: [ME] }, note(ME))).toBe(true)
  })

  it('accepts a note from anyone the author feed lists', () => {
    const source: FeedSource = { kind: 'authors', authors: [ME, THEM] }
    expect(belongsInSource(source, note(THEM))).toBe(true)
  })

  it('matches a hashtag feed only on the hashtag', () => {
    const source: FeedSource = { kind: 'hashtag', tag: 'bitcoin' }
    expect(belongsInSource(source, note(ME, [['t', 'bitcoin']]))).toBe(true)
    expect(belongsInSource(source, note(ME, [['t', 'nostr']]))).toBe(false)
    expect(belongsInSource(source, note(ME))).toBe(false)
  })

  it('matches a hashtag whatever case either side used', () => {
    expect(belongsInSource({ kind: 'hashtag', tag: 'Bitcoin' }, note(ME, [['t', 'bitcoin']]))).toBe(true)
    expect(belongsInSource({ kind: 'hashtag', tag: 'bitcoin' }, note(ME, [['t', 'BITCOIN']]))).toBe(true)
  })

  it('ORs a custom feed, matching the relay filters it sends', () => {
    const source: FeedSource = { kind: 'custom', hashtags: ['nostr'], authors: [THEM] }
    expect(belongsInSource(source, note(THEM))).toBe(true)
    expect(belongsInSource(source, note(ME, [['t', 'nostr']]))).toBe(true)
    expect(belongsInSource(source, note(ME))).toBe(false)
  })

  it('never puts a note published a second ago into trending', () => {
    expect(belongsInSource({ kind: 'trending', hours: 4, ids: [] }, note(ME))).toBe(false)
  })

  it('leaves the verified feed to say no, since the event cannot answer it', () => {
    // Whether the author holds a verified NIP-05 is not in the event.
    expect(belongsInSource({ kind: 'verified' }, note(ME))).toBe(false)
  })

  it('ignores tags that are not hashtags', () => {
    const source: FeedSource = { kind: 'hashtag', tag: 'bitcoin' }
    // A `p` tag naming something called bitcoin is a mention, not a topic.
    expect(belongsInSource(source, note(ME, [['p', 'bitcoin']]))).toBe(false)
  })
})

/** Whether the Following feed ever asks a relay for the reader's own notes. */
describe('withSelf', () => {
  it('asks for the reader, who is not in their own follow list', () => {
    expect(withSelf([THEM], ME)).toContain(ME)
  })

  it('puts the reader FIRST, so a capped follow list can never drop them', () => {
    // `authorFilters` sends a bounded number of chunks and discards the tail.
    const many = Array.from({ length: 2_500 }, (_, i) => String(i).padStart(64, '0'))
    expect(withSelf(many, ME)[0]).toBe(ME)
  })

  it('does not name the reader twice when they follow themselves', () => {
    expect(withSelf([ME, THEM], ME)).toEqual([ME, THEM])
  })

  it('changes nothing for a logged-out reader', () => {
    expect(withSelf([THEM], undefined)).toEqual([THEM])
  })

  it('does not disturb the list it was given', () => {
    const follows = [THEM]
    withSelf(follows, ME)
    expect(follows).toEqual([THEM])
  })

  it('makes my own note belong in my own timeline', () => {
    const following: FeedSource = { kind: 'authors', authors: withSelf([THEM], ME) }
    expect(belongsInSource(following, note(ME))).toBe(true)
    // And still keeps it off somebody else's, which is what `belongsInSource` exists.
    expect(belongsInSource({ kind: 'authors', authors: [THEM] }, note(ME))).toBe(false)
  })
})

/** Which feeds carry replies. */
describe('keepsReplies', () => {
  it('keeps them off a Following timeline', () => {
    expect(keepsReplies({ kind: 'authors', authors: withSelf([THEM], ME) })).toBe(false)
  })

  it('keeps them off a profile asked for as posts', () => {
    expect(keepsReplies({ kind: 'authors', authors: [THEM], include: 'posts' })).toBe(false)
  })

  it('keeps them on a profile asked for as posts AND replies', () => {
    expect(keepsReplies({ kind: 'authors', authors: [THEM], include: 'all' })).toBe(true)
  })

  it('keeps them off every feed the reader did not curate', () => {
    expect(keepsReplies({ kind: 'verified' })).toBe(false)
    expect(keepsReplies({ kind: 'hashtag', tag: 'bitcoin' })).toBe(false)
    expect(keepsReplies({ kind: 'trending', hours: 24, ids: [] })).toBe(false)
    expect(keepsReplies({ kind: 'custom', hashtags: ['nostr'], authors: [THEM] })).toBe(false)
  })
})

/** Whether arriving notes wait behind "Show N notes". */
describe('holdsArrivals', () => {
  const following: FeedSource = { kind: 'authors', authors: [ME, THEM] }
  const trending: FeedSource = { kind: 'trending', hours: 4, ids: [] }

  it('does not hold the first page of a feed still loading', () => {
    expect(holdsArrivals(false, 0, following)).toBe(false)
    expect(holdsArrivals(false, 40, following)).toBe(false)
  })

  it('holds later arrivals once there are rows to protect', () => {
    expect(holdsArrivals(true, 40, following)).toBe(true)
  })

  it('NEVER holds everything back from an empty timeline', () => {
    // The reported bug: settled, nothing on screen, and 619 notes behind the button.
    expect(holdsArrivals(true, 0, following)).toBe(false)
  })

  /** Trending has no reading position to protect. */
  it('never holds on trending, whatever the feed state', () => {
    expect(holdsArrivals(true, 40, trending)).toBe(false)
    expect(holdsArrivals(true, 0, trending)).toBe(false)
    expect(holdsArrivals(false, 40, trending)).toBe(false)
  })

  it('still holds on every other discovery surface', () => {
    // Verified and hashtag ARE chronological, so a row can still be pushed.
    expect(holdsArrivals(true, 40, { kind: 'verified' })).toBe(true)
    expect(holdsArrivals(true, 40, { kind: 'hashtag', tag: 'bitcoin' })).toBe(true)
  })
})
