import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Hex, NostrEvent, Profile } from '@nostrich/nostr'

import { buildWindow } from './build'
import { countShownReplies } from './replies'
import type { SourceResult } from './sources'

/** A NOTE MAY NOT BE RANKED BY REPLIES ITS READERS WILL NEVER SEE. */

const key = (n: number): Hex => n.toString(16).padStart(64, '0') as Hex

/** A day old, so the window-graduation rule is not what these tests are measuring. */
const note = (id: Hex, pubkey: Hex): NostrEvent =>
  ({ id, pubkey, kind: 1, created_at: 1_700_000_000 - 86_400, content: 'x', tags: [], sig: '' }) as NostrEvent

const profileEvent = (pubkey: Hex, content: object): NostrEvent =>
  ({ id: key(900), pubkey, kind: 0, created_at: 1, content: JSON.stringify(content), tags: [], sig: '' }) as NostrEvent

/** `rejectionFor` requires one. */
const PIC = 'https://example.com/a.png'

const AUTHOR = key(1)
const FARMED = key(10)
const HONEST = key(11)

// --------------------------------------------------------------------------- Valid.
const INVOICE =
  'lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qrsgq7ea976txfraylvgzuxs8kgcw23ezlrszfnh8r6qtfpr6cxga50aj6txm9rxrydzd06dfeawfk6swupvz4erwnyutnjq7x39ymw6j38gp7ynn44'
const INVOICE_SATS = 2_000_000

const zapRecipientSecret = generateSecretKey()
const ZAP_RECIPIENT = getPublicKey(zapRecipientSecret)
const zapServerSecret = generateSecretKey()

/** One validated zap: the payer signs the request, the "LNURL server" signs the receipt. */
const signedZap = (payerSecret: Uint8Array, target: Hex, createdAt = 2): NostrEvent => {
  const request = finalizeEvent(
    { kind: 9734, created_at: 1, content: '', tags: [['p', ZAP_RECIPIENT], ['e', target]] },
    payerSecret,
  )
  return finalizeEvent(
    {
      kind: 9735,
      // Distinct created_at per receipt: the id is derived from the fields, and the counter.
      created_at: createdAt,
      content: '',
      tags: [
        ['p', ZAP_RECIPIENT],
        ['e', target],
        ['bolt11', INVOICE],
        ['description', JSON.stringify(request)],
      ],
    },
    zapServerSecret,
  ) as unknown as NostrEvent
}

function sources(replies: number): { name: string; result: SourceResult }[] {
  return [{
    name: 'index',
    result: {
      notes: [
        { id: FARMED, counts: { replies, reposts: 0, quotes: 0, reactions: 2, zapSats: 0, zapCount: 0 }, event: note(FARMED, AUTHOR) },
        { id: HONEST, counts: { replies: 3, reposts: 2, quotes: 0, reactions: 40, zapSats: 500, zapCount: 3 }, event: note(HONEST, key(2)) },
      ],
      profiles: [
        profileEvent(AUTHOR, { name: 'Author', nip05: 'a@b.com', picture: PIC }),
        profileEvent(key(2), { name: 'Other', nip05: 'o@b.com', picture: PIC }),
      ],
    },
  }]
}

describe('buildWindow with a reply re-count', () => {
  it('ranks the farmed note above an honest one when the raw counts are believed', () => {
    /* The behaviour being fixed: enough manufactured replies beat real engagement. */
    const result = buildWindow(24, sources(40), 1_700_000_000)
    expect(result.payload.notes[0]?.id).toBe(FARMED)
  })

  it('drops it below once only the replies we would show are counted', () => {
    // Same note, same indexes.
    const result = buildWindow(24, sources(26), 1_700_000_000, new Map([[FARMED, { replies: 0, reposts: 0, quotes: 0, reactions: 0, zapCount: 0, zapSats: 0 }]]))
    expect(result.payload.notes[0]?.id).toBe(HONEST)
  })

  it('replaces the count rather than taking the fuller answer', () => {
    // `betterCounts` takes the maximum everywhere else, which is right when two indexes.
    const result = buildWindow(24, sources(26), 1_700_000_000, new Map([[FARMED, { replies: 1, reposts: 0, quotes: 0, reactions: 0, zapCount: 0, zapSats: 0 }]]))
    const farmed = result.payload.notes.find(row => row.id === FARMED)
    expect(farmed?.counts.replies).toBe(1)
  })

  it('leaves a note alone when it was not re-counted', () => {
    // "We could not check" and "these are fake" are different claims, and only one.
    const result = buildWindow(24, sources(26), 1_700_000_000, new Map())
    expect(result.payload.notes.find(row => row.id === FARMED)?.counts.replies).toBe(26)
  })
})

/** THE ALL-SPAM CASE, which the first version of this could not touch. */
describe('a note whose replies are ALL uncountable', () => {
  it('is scored on zero replies, not on the index count', () => {
    const result = buildWindow(24, sources(26), 1_700_000_000, new Map([[FARMED, { replies: 0, reposts: 0, quotes: 0, reactions: 0, zapCount: 0, zapSats: 0 }]]))
    const farmed = result.payload.notes.find(row => row.id === FARMED)
    expect(farmed?.counts.replies).toBe(0)
    expect(result.payload.notes[0]?.id).toBe(HONEST)
  })
})

describe('countShownReplies', () => {
  // Distinct ids per event: the counter deduplicates by event id.
  const reply = (author: Hex, parent: Hex, id = 500): NostrEvent =>
    ({ id: key(id), pubkey: author, kind: 1, created_at: 1, content: 'x', tags: [['e', parent]], sig: '' }) as NostrEvent

  // A picture is now required too.
  const named: Profile = { name: 'Real', nip05: 'r@b.com', picture: 'https://x/y.jpg' } as Profile

  it('records ZERO for a note whose replies are all uncountable', () => {
    // THE BUG.
    const profiles = new Map<Hex, Profile | null>([[key(30), null]])
    const result = countShownReplies([FARMED], [reply(key(30), FARMED, 501), reply(key(30), FARMED, 502)], profiles)
    expect(result.kept.get(FARMED)?.replies).toBe(0)
    expect(result.dropped).toBe(2)
  })

  it('counts the replies that would be shown', () => {
    const profiles = new Map<Hex, Profile | null>([[key(31), named], [key(30), null]])
    const result = countShownReplies([FARMED], [reply(key(31), FARMED, 501), reply(key(30), FARMED, 502)], profiles)
    expect(result.kept.get(FARMED)?.replies).toBe(1)
  })

  it('says nothing about a note it saw no replies for', () => {
    // Its replies may simply live on relays we do not read, which is not evidence.
    const result = countShownReplies([FARMED, HONEST], [reply(key(30), FARMED)], new Map())
    expect(result.kept.has(HONEST)).toBe(false)
  })

  it('ignores a reply pointing at something that is not a candidate', () => {
    const result = countShownReplies([FARMED], [reply(key(30), key(999))], new Map())
    expect(result.kept.size).toBe(0)
  })
})

/** FOUR THINGS A REPLIER MUST BE before their reply may rank somebody else's note. */
describe('who may contribute to trending', () => {
  const NOTE = key(60)
  const REPLIER = key(61)
  const reply = (): NostrEvent =>
    ({ id: key(62), pubkey: REPLIER, kind: 1, created_at: 1, content: 'nice', tags: [['e', NOTE]], sig: '' }) as NostrEvent

  const full: Profile = {
    name: 'Real Person',
    nip05: 'real@example.com',
    picture: 'https://example.com/me.jpg',
  } as Profile

  const good = { notes: 20, replies: 30 }

  const count = (profile: Profile | null, history?: { notes: number; replies: number }) =>
    countShownReplies(
      [NOTE],
      [reply()],
      new Map([[REPLIER, profile]]),
      history === undefined ? new Map() : new Map([[REPLIER, history]]),
    ).kept.get(NOTE)?.replies

  it('counts a reply from an established account', () => {
    expect(count(full, good)).toBe(1)
  })

  it('refuses an account with fewer than ten notes', () => {
    expect(count(full, { notes: 9, replies: 30 })).toBe(0)
  })

  it('refuses an account with fewer than ten replies', () => {
    expect(count(full, { notes: 20, replies: 9 })).toBe(0)
  })

  it('refuses an account with no picture', () => {
    expect(count({ ...full, picture: undefined } as Profile, good)).toBe(0)
  })

  it('refuses an account with no display name, still just an npub on screen', () => {
    expect(count({ ...full, name: undefined, displayName: undefined } as Profile, good)).toBe(0)
  })

  it('keeps the reply when the history could not be measured', () => {
    // "We could not look it up" and "this account is new" are different claims.
    expect(count(full)).toBe(1)
  })
})

/** A NOTE WHOSE REPLIES NOBODY CAN FETCH HAS NO VERIFIED REPLIES. */
describe('unverifiable replies', () => {
  it('records zero for a note nothing could be fetched for', () => {
    const result = countShownReplies([FARMED], [], new Map())
    // `countShownReplies` alone says nothing.
    expect(result.kept.has(FARMED)).toBe(false)
  })

  it('still counts a note whose replies DID come back', () => {
    const reply = {
      id: key(70), pubkey: key(71), kind: 1, created_at: 1, content: 'x',
      tags: [['e', FARMED]], sig: '',
    } as NostrEvent
    const profiles = new Map<Hex, Profile | null>([[key(71), null]])
    expect(countShownReplies([FARMED], [reply], profiles).kept.get(FARMED)?.replies).toBe(0)
  })
})

/** A NOTE GRADUATES THROUGH THE WINDOWS. */
describe('window graduation', () => {
  const NOW = 1_700_000_000
  const aged = (id: Hex, secondsOld: number, replies: number): { name: string; result: SourceResult } => ({
    name: 'index',
    result: {
      notes: [{
        id,
        counts: { replies, reposts: 5, quotes: 0, reactions: 50, zapSats: 900, zapCount: 5 },
        event: { ...note(id, AUTHOR), created_at: NOW - secondsOld } as NostrEvent,
      }],
      profiles: [profileEvent(AUTHOR, { name: 'Author', nip05: 'a@b.com', picture: PIC })],
    },
  })

  it('lets a brand-new note into the 1h list', () => {
    const out = buildWindow(1, [aged(key(20), 600, 9)], NOW)
    expect(out.payload.notes.map(n => n.id)).toEqual([key(20)])
  })

  it('keeps a ten-minute-old note OUT of the 4h list', () => {
    const out = buildWindow(4, [aged(key(20), 600, 9)], NOW)
    expect(out.payload.notes).toEqual([])
    expect(out.rejected['too-new']).toBe(1)
  })

  it('keeps a two-hour-old note OUT of the 24h list', () => {
    const out = buildWindow(24, [aged(key(20), 2 * 3600, 9)], NOW)
    expect(out.payload.notes).toEqual([])
  })

  it('admits it once it has served its time', () => {
    expect(buildWindow(4, [aged(key(20), 2 * 3600, 9)], NOW).payload.notes).toHaveLength(1)
    expect(buildWindow(24, [aged(key(20), 5 * 3600, 9)], NOW).payload.notes).toHaveLength(1)
  })
})

/** EVERY COUNT IS PEOPLE, NOT EVENTS. */
describe('distinct people, not events', () => {
  const NOTE2 = key(80)
  const ALICE = key(81)
  const BOB = key(82)

  const full: Profile = { name: 'A', nip05: 'a@b.com', picture: 'https://x/a.jpg' } as Profile
  const profiles = new Map<Hex, Profile | null>([[ALICE, full], [BOB, full]])
  const history = new Map([[ALICE, { notes: 20, replies: 20 }], [BOB, { notes: 20, replies: 20 }]])

  const ev = (kind: number, author: Hex, id: number): NostrEvent =>
    ({ id: key(id), pubkey: author, kind, created_at: 1, content: '+', tags: [['e', NOTE2]], sig: '' }) as NostrEvent

  // Real signed receipts.
  const aliceWallet = generateSecretKey()
  const bobWallet = generateSecretKey()

  it('counts one person replying five times as one', () => {
    const events = [ev(1, ALICE, 90), ev(1, ALICE, 91), ev(1, ALICE, 92), ev(1, ALICE, 93), ev(1, ALICE, 94)]
    expect(countShownReplies([NOTE2], events, profiles, history).kept.get(NOTE2)?.replies).toBe(1)
  })

  it('counts two people replying as two', () => {
    const events = [ev(1, ALICE, 90), ev(1, ALICE, 91), ev(1, BOB, 92)]
    expect(countShownReplies([NOTE2], events, profiles, history).kept.get(NOTE2)?.replies).toBe(2)
  })

  it('counts one person zapping five times as one', () => {
    const events = [2, 3, 4, 5, 6].map(at => signedZap(aliceWallet, NOTE2, at))
    expect(countShownReplies([NOTE2], events, profiles, history).kept.get(NOTE2)?.zapCount).toBe(1)
  })

  it('reads the PAYER out of the receipt, not the lightning server', () => {
    // Both receipts are signed by the same server key.
    const events = [signedZap(aliceWallet, NOTE2, 2), signedZap(bobWallet, NOTE2, 3)]
    expect(countShownReplies([NOTE2], events, profiles, history).kept.get(NOTE2)?.zapCount).toBe(2)
  })

  it('counts one person reacting and reposting repeatedly as one each', () => {
    const events = [ev(7, ALICE, 90), ev(7, ALICE, 91), ev(6, ALICE, 92), ev(6, ALICE, 93)]
    const out = countShownReplies([NOTE2], events, profiles, history).kept.get(NOTE2)
    expect(out?.reactions).toBe(1)
    expect(out?.reposts).toBe(1)
  })

  it('does not judge a zapper, money is its own gate', () => {
    // No profile, no history for this payer.
    const events = [signedZap(generateSecretKey(), NOTE2, 2)]
    const out = countShownReplies([NOTE2], events, new Map(), new Map()).kept.get(NOTE2)
    expect(out?.zapCount).toBe(1)
  })

  it('judges a reposter like a replier, a repost is ×2 per keypair otherwise', () => {
    // key(83) has no profile.
    const events = [ev(6, key(83), 90), ev(6, ALICE, 91)]
    const out = countShownReplies([NOTE2], events, profiles, history).kept.get(NOTE2)
    expect(out?.reposts).toBe(1)
  })

  it('counts a kind-16 generic repost the same as a kind 6', () => {
    const events = [ev(16, ALICE, 90)]
    const out = countShownReplies([NOTE2], events, profiles, history).kept.get(NOTE2)
    expect(out?.reposts).toBe(1)
  })
})

/** A QUOTE COUNTS AS A REPOST. */
describe('quotes', () => {
  const NOTE3 = key(85)
  const ALICE = key(81)
  const full: Profile = { name: 'A', nip05: 'a@b.com', picture: 'https://x/a.jpg' } as Profile
  const profiles = new Map<Hex, Profile | null>([[ALICE, full]])
  const history = new Map([[ALICE, { notes: 20, replies: 20 }]])

  const quote = (author: Hex, id: number): NostrEvent =>
    ({ id: key(id), pubkey: author, kind: 1, created_at: 1, content: 'look at this', tags: [['q', NOTE3]], sig: '' }) as NostrEvent

  it('counts a quote as a repost AND as the quote subset, the 1.5× top-up', () => {
    const out = countShownReplies([NOTE3], [quote(ALICE, 90)], profiles, history).kept.get(NOTE3)
    expect(out?.reposts).toBe(1)
    expect(out?.quotes).toBe(1)
    expect(out?.replies).toBe(0)
  })

  it('counts a plain repost in reposts only, no top-up', () => {
    const repost = { id: key(91), pubkey: ALICE, kind: 6, created_at: 1, content: '', tags: [['e', NOTE3]], sig: '' } as NostrEvent
    const out = countShownReplies([NOTE3], [repost], profiles, history).kept.get(NOTE3)
    expect(out?.reposts).toBe(1)
    expect(out?.quotes).toBe(0)
  })

  it('drops a quote from an account the gate refuses', () => {
    const result = countShownReplies([NOTE3], [quote(key(86), 90)], new Map(), new Map())
    expect(result.kept.get(NOTE3)?.reposts).toBe(0)
    expect(result.kept.get(NOTE3)?.quotes).toBe(0)
    expect(result.dropped).toBe(1)
  })

  it('classifies an event that replies to one candidate and quotes another as a reply', () => {
    // `e`/`a` outrank `q`: it joined the first note's thread.
    const OTHER = key(87)
    const both = {
      id: key(90), pubkey: ALICE, kind: 1, created_at: 1, content: 'x',
      tags: [['e', NOTE3], ['q', OTHER]], sig: '',
    } as NostrEvent
    const out = countShownReplies([NOTE3, OTHER], [both], profiles, history)
    expect(out.kept.get(NOTE3)?.replies).toBe(1)
    expect(out.kept.get(OTHER)?.reposts ?? 0).toBe(0)
  })
})

/** A ZAP COUNTS ONLY IF ITS RECEIPT VALIDATES. */
describe('verified zap amounts', () => {
  const NOTE4 = key(88)

  /** The forgeable shape: a bare description naming a payer, no real signatures. */
  const forgedZap = (payer: Hex, id: number): NostrEvent =>
    ({
      id: key(id), pubkey: key(99), kind: 9735, created_at: 1, content: '', sig: '',
      tags: [['e', NOTE4], ['description', JSON.stringify({ pubkey: payer })]],
    }) as NostrEvent

  it('sums the sats of receipts that validate', () => {
    const events = [signedZap(generateSecretKey(), NOTE4, 2), signedZap(generateSecretKey(), NOTE4, 3)]
    const out = countShownReplies([NOTE4], events, new Map(), new Map()).kept.get(NOTE4)
    expect(out?.zapCount).toBe(2)
    expect(out?.zapSats).toBe(2 * INVOICE_SATS)
  })

  it('refuses a forged receipt entirely, no person, no money', () => {
    // Twenty of these used to be sixty points.
    const result = countShownReplies([NOTE4], [forgedZap(key(81), 91)], new Map(), new Map())
    expect(result.kept.get(NOTE4)?.zapCount).toBe(0)
    expect(result.kept.get(NOTE4)?.zapSats).toBe(0)
    expect(result.dropped).toBe(1)
  })

  it('counts the same receipt once however many queries returned it', () => {
    const receipt = signedZap(generateSecretKey(), NOTE4, 2)
    const out = countShownReplies([NOTE4], [receipt, receipt], new Map(), new Map()).kept.get(NOTE4)
    expect(out?.zapCount).toBe(1)
    expect(out?.zapSats).toBe(INVOICE_SATS)
  })
})
