import { describe, expect, it } from 'vitest'
import type { Hex, NostrEvent, Profile } from '@nostrich/nostr'

import { betterCounts, buildWindow, mergeSources, rejectionFor, type Merged } from './build'
import { parseWine, type SourceResult } from './sources'
import { uncheckedIn } from './builder'
import { chunk as chunkIds } from './resolve'

/** Ranking on the server must not loosen a single rule the client applied. */

const key = (n: number): Hex => n.toString(16).padStart(64, '0') as Hex

/** A day old by default, so window graduation is not what these tests are measuring. */
const note = (over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: key(900),
    pubkey: key(1),
    kind: 1,
    created_at: 1_700_000_000 - 86_400,
    content: 'a perfectly ordinary note',
    tags: [],
    sig: '',
    ...over,
  }) as NostrEvent

/** Every fixture below carries one, because `rejectionFor` requires. */
const PIC = 'https://example.com/alice.png'

const good: Profile = { name: 'Alice', nip05: 'alice@example.com', picture: PIC } as Profile

const entry = (over: Partial<Merged> = {}): Merged => ({
  id: key(900),
  counts: { replies: 3, reposts: 2, quotes: 0, reactions: 40, zapSats: 500, zapCount: 4 },
  event: note(),
  sources: ['wine'],
  ...over,
})

/** Explicit `null` for "this author has no profile". */
const judge = (e: Merged, profile: Profile | null = good, requireNip05 = true) =>
  rejectionFor(e, { profileOf: () => profile ?? undefined, requireNip05 })

describe('rejectionFor, our rules, applied server-side', () => {
  it('accepts an ordinary note from an identified author', () => {
    expect(judge(entry())).toBeUndefined()
  })

  it('drops an id we could not resolve to a note', () => {
    // the index gives ids without notes.
    expect(judge(entry({ event: undefined }))).toBe('no-event')
  })

  it('drops the hand-maintained blocklist', () => {
    // The synthetic entry seeded in `BLOCKED`.
    const blocked = ('2'.repeat(64)) as Hex
    expect(judge(entry({ event: note({ pubkey: blocked }) }))).toBe('blocked')
  })

  it('drops an account kept off the charts, under its own reason', () => {
    // `NOT_TRENDING` exists so the charts can refuse an account without the app.
    const wire = ('1'.repeat(64)) as Hex
    expect(judge(entry({ event: note({ pubkey: wire }) }))).toBe('not-trending')
  })

  it('drops tag stuffing', () => {
    const tags = Array.from({ length: 60 }, (_, i) => ['t', `tag${i}`])
    expect(judge(entry({ event: note({ tags }) }))).toBe('tag-stuffed')
  })

  it('drops an author with no profile at all', () => {
    // Not "unknown, so allow": a note promoted network-wide should have an author.
    expect(judge(entry(), null)).toBe('no-profile')
  })

  it('drops an adult display name', () => {
    expect(judge(entry(), { name: 'XXX Cam Girls', nip05: 'x@y.com' } as Profile)).toBe('adult-name')
  })

  it('drops a nameless author', () => {
    expect(judge(entry(), { nip05: 'x@y.com' } as Profile)).toBe('no-name')
  })

  it('KEEPS an author with no NIP-05 at all', () => {
    /* This required one, and required it in the weakest possible way: the field being. */
    const anon = { name: 'Alice', picture: PIC } as Profile
    expect(judge(entry(), anon)).toBeUndefined()
    expect(judge(entry(), anon, false)).toBeUndefined()
  })

  it('drops a reply that links to the author own advertised site', () => {
    // A link-dropping account: a real name, a real picture, replies to dozens.
    const promo = { name: 'Marcus Reid', nip05: 'm@x.com', picture: PIC, website: 'https://marcus-writes.example' } as Profile
    const reply = note({ tags: [['e', key(50)]], content: 'Great point, more at https://marcus-writes.example/x' })
    expect(judge(entry({ event: reply }), promo)).toBe('self-promoting-reply')
  })

  /** THE CAMPAIGN DOMAIN. */
  it('rejects an account that claims the campaign domain, ahead of the NIP-05 gate', () => {
    const persona = { name: 'Example Persona', website: 'https://example-campaign.test' } as Profile
    // No NIP-05 at all, and `requireNip05` on: `no-nip05` would otherwise answer first.
    expect(judge(entry(), persona)).toBe('campaign-domain')
    // The banner alone is enough.
    expect(judge(entry(), { name: 'Anna', nip05: 'a@x.com', banner: 'https://example-campaign.test/og.png' } as Profile))
      .toBe('campaign-domain')
    // And the NIP-05 domain, which is the upgrade that would otherwise walk them past.
    expect(judge(entry(), { name: 'Anna', nip05: 'anna@example-campaign.test' } as Profile)).toBe('campaign-domain')
  })

  /** THE WARNER. The whole reason the bio is not read and the note body is not read. */
  it('leaves alone somebody who merely writes about the campaign', () => {
    const warner = { name: 'franzap', nip05: 'fran@zapstore.dev', picture: PIC, website: 'https://zapstore.dev/' } as Profile
    const warning = note({ content: 'heads up: example-campaign.test is an AI slop farm https://example-campaign.test/x' })
    expect(judge(entry({ event: warning }), warner)).toBeUndefined()
  })

  it('drops engagement that is replies and nothing else', () => {
    // A reply farm: dozens of replies, and not one like, repost or zap from anybody.
    const farmed = entry({ counts: { replies: 30, reposts: 0, quotes: 0, reactions: 0, zapSats: 0, zapCount: 0 } })
    expect(judge(farmed)).toBe('manipulated')
  })
})

describe('betterCounts', () => {
  it('takes the fuller answer, never the thinner one', () => {
    // One index reporting no zaps is that index having seen less, never the note having.
    const a = { replies: 5, reposts: 0, quotes: 0, reactions: 10, zapSats: 0, zapCount: 0 }
    const b = { replies: 2, reposts: 3, quotes: 0, reactions: 40, zapSats: 900, zapCount: 6 }
    expect(betterCounts(a, b)).toEqual({ replies: 5, reposts: 3, quotes: 0, reactions: 40, zapSats: 900, zapCount: 6 })
  })
})

describe('mergeSources', () => {
  const res = (notes: SourceResult['notes']): SourceResult => ({ notes, profiles: [] })

  it('unions the two indexes and records which offered what', () => {
    const merged = mergeSources([
      { name: 'wine', result: res([{ id: key(1), counts: { replies: 1, reposts: 0, quotes: 0, reactions: 0, zapSats: 0, zapCount: 0 } }]) },
      { name: 'index', result: res([{ id: key(2), counts: { replies: 0, reposts: 0, quotes: 0, reactions: 5, zapSats: 0, zapCount: 0 } }]) },
    ])
    expect(merged.map(m => m.id)).toEqual([key(1), key(2)])
    expect(merged.map(m => m.sources)).toEqual([['wine'], ['index']])
  })

  it('keeps the note body from whichever index actually shipped one', () => {
    // the index offers an id.
    const body = note({ id: key(1) })
    const merged = mergeSources([
      { name: 'wine', result: res([{ id: key(1), counts: { replies: 1, reposts: 0, quotes: 0, reactions: 0, zapSats: 0, zapCount: 0 } }]) },
      { name: 'index', result: res([{ id: key(1), counts: { replies: 0, reposts: 0, quotes: 0, reactions: 9, zapSats: 0, zapCount: 0 } , event: body }]) },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.event).toBe(body)
    expect(merged[0]?.sources).toEqual(['wine', 'index'])
    expect(merged[0]?.counts).toEqual({ replies: 1, reposts: 0, quotes: 0, reactions: 9, zapSats: 0, zapCount: 0 })
  })
})

describe('buildWindow', () => {
  const profileEvent = (pubkey: Hex, content: object, at = 1): NostrEvent =>
    ({ id: key(800), pubkey, kind: 0, created_at: at, content: JSON.stringify(content), tags: [], sig: '' }) as NostrEvent

  it('keeps one note per author, and the better one', () => {
    // A ring with two accounts and four notes must not occupy four of ten rows.
    const author = key(1)
    const weak = note({ id: key(10), pubkey: author })
    const strong = note({ id: key(11), pubkey: author })
    const result = buildWindow(24, [{
      name: 'index',
      result: {
        notes: [
          { id: key(10), counts: { replies: 1, reposts: 1, quotes: 0, reactions: 2, zapSats: 10, zapCount: 1 }, event: weak },
          { id: key(11), counts: { replies: 9, reposts: 9, quotes: 0, reactions: 90, zapSats: 9000, zapCount: 9 }, event: strong },
        ],
        profiles: [profileEvent(author, { name: 'Alice', nip05: 'a@b.com', picture: PIC })],
      },
    }], 1_700_000_000)

    expect(result.payload.notes.map(n => n.id)).toEqual([key(11)])
    expect(result.rejected['duplicate-author']).toBe(1)
  })

  /** The charts drifted on their own because the cutoff sits inside a wall of equal. */
  it('gives a tied slot to the note that already had it', () => {
    const older = key(1)
    const newer = key(2)
    // Identical engagement, so only the tiebreak can separate them.
    const counts = { replies: 2, reposts: 1, quotes: 0, reactions: 9, zapSats: 100, zapCount: 1 }
    const sources = [{
      name: 'index',
      result: {
        notes: [
          { id: key(10), counts, event: note({ id: key(10), pubkey: older }) },
          { id: key(11), counts, event: note({ id: key(11), pubkey: newer }) },
        ],
        profiles: [
          profileEvent(older, { name: 'Alice', nip05: 'a@b.com', picture: PIC }),
          profileEvent(newer, { name: 'Bob', nip05: 'b@b.com', picture: PIC }),
        ],
      },
    }]

    // No incumbents: the id decides, which is the old behaviour and still the fallback.
    const cold = buildWindow(24, sources, 1_700_000_000)
    expect(cold.payload.notes.map(n => n.id)).toEqual([key(10), key(11)])

    // key(11) held the top slot last time, so a tie keeps it there.
    const warm = buildWindow(24, sources, 1_700_000_000, new Map(), new Set([key(11)]))
    expect(warm.payload.notes.map(n => n.id)).toEqual([key(11), key(10)])
  })

  it('never lets incumbency beat a better score', () => {
    // The rule must not ossify a chart: a note that genuinely outranks an incumbent takes.
    const sitting = key(1)
    const rising = key(2)
    const result = buildWindow(24, [{
      name: 'index',
      result: {
        notes: [
          { id: key(10), counts: { replies: 1, reposts: 0, quotes: 0, reactions: 1, zapSats: 0, zapCount: 0 }, event: note({ id: key(10), pubkey: sitting }) },
          { id: key(11), counts: { replies: 9, reposts: 9, quotes: 0, reactions: 90, zapSats: 9000, zapCount: 9 }, event: note({ id: key(11), pubkey: rising }) },
        ],
        profiles: [
          profileEvent(sitting, { name: 'Alice', nip05: 'a@b.com', picture: PIC }),
          profileEvent(rising, { name: 'Bob', nip05: 'b@b.com', picture: PIC }),
        ],
      },
    }], 1_700_000_000, new Map(), new Set([key(10)]))

    expect(result.payload.notes.map(n => n.id)).toEqual([key(11), key(10)])
  })

  it('ships only the profiles of the notes it kept', () => {
    // Two hundred profiles to render forty rows is the quiet weight that makes a fast.
    const kept = key(1)
    const dropped = key(2)
    const result = buildWindow(24, [{
      name: 'index',
      result: {
        notes: [
          { id: key(10), counts: { replies: 2, reposts: 1, quotes: 0, reactions: 9, zapSats: 100, zapCount: 1 }, event: note({ id: key(10), pubkey: kept }) },
          { id: key(11), counts: { replies: 2, reposts: 1, quotes: 0, reactions: 9, zapSats: 100, zapCount: 1 }, event: note({ id: key(11), pubkey: dropped }) },
        ],
        profiles: [
          profileEvent(kept, { name: 'Alice', nip05: 'a@b.com', picture: PIC }),
          profileEvent(dropped, { name: 'XXX Cams', nip05: 'x@y.com', picture: PIC }),
        ],
      },
    }], 1_700_000_000)

    expect(result.payload.notes).toHaveLength(1)
    expect(result.payload.profiles.map(p => p.pubkey)).toEqual([kept])
    expect(result.rejected['adult-name']).toBe(1)
  })
})

describe('parseWine', () => {
  it('reads their rows and ignores anything that is not a 64-hex id', () => {
    expect(
      parseWine([
        { event_id: key(1), replies: 2, reposts: 1, quotes: 0, reactions: 30, zap_amount: 210, zap_count: 3 },
        { event_id: 'not-an-id', replies: 9 },
        { replies: 9 },
      ]),
    ).toEqual([{ id: key(1), counts: { replies: 2, reposts: 1, quotes: 0, reactions: 30, zapSats: 210, zapCount: 3 } }])
  })
})

describe('chunk', () => {
  it('splits ids into batches a relay will accept whole', () => {
    // Relays reject an oversized REQ wholesale rather than truncating.
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('has nothing to split when there is nothing', () => {
    expect(chunkIds([], 10)).toEqual([])
  })
})

describe('uncheckedIn, what makes the verification loop terminate', () => {
  it('asks about a note nobody has looked at', () => {
    expect(uncheckedIn(['a', 'b'], new Set(), new Set())).toEqual(['a', 'b'])
  })

  it('does not re-ask a note that ANSWERED', () => {
    expect(uncheckedIn(['a', 'b'], new Set(['a']), new Set())).toEqual(['b'])
  })

  it('does not re-ask a note that was asked and stayed SILENT', () => {
    /* THE SPIN THIS EXISTS. */
    expect(uncheckedIn(['a', 'b'], new Set(), new Set(['a', 'b']))).toEqual([])
  })

  it('converges: a second round after an unanswered first is empty', () => {
    const ids = ['a', 'b', 'c']
    const shown = new Set<string>()
    const asked = new Set<string>()
    const first = uncheckedIn(ids, shown, asked)
    expect(first).toHaveLength(3)
    for (const id of first) asked.add(id)
    // Nothing answered.
    expect(uncheckedIn(ids, shown, asked)).toEqual([])
  })

  it('still picks up a note that only entered the list on a later pass', () => {
    // The reason the loop repeats at all: demoting a note promotes one nobody asked.
    const asked = new Set(['a'])
    expect(uncheckedIn(['a', 'newcomer'], new Set(['a']), asked)).toEqual(['newcomer'])
  })
})
