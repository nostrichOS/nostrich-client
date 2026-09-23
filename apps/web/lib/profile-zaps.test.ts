import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent, QueryOutcome } from '@nostrich/nostr'

const queryWithStatus = vi.fn<(...args: unknown[]) => Promise<QueryOutcome>>()

vi.mock('./pool', () => ({ getPool: () => ({ queryWithStatus, readRelays: () => ['wss://a.example'] }) }))

const { pageReceipts, amountFromBolt11, sentEntry } = await import('./profile-zaps')

const PUBKEY = 'a'.repeat(64)

function receipt(id: string, createdAt: number): NostrEvent {
  return {
    id,
    pubkey: 'b'.repeat(64),
    created_at: createdAt,
    kind: 9735,
    tags: [['p', PUBKEY]],
    content: '',
    sig: '0'.repeat(128),
  }
}

function answered(events: NostrEvent[], relays = 3): QueryOutcome {
  return { events, answered: relays, attempted: 3 }
}

beforeEach(() => {
  queryWithStatus.mockReset()
})

/** The rule this file exists. */
describe('pageReceipts', () => {
  it('throws rather than returning empty when no relay answered', async () => {
    queryWithStatus.mockResolvedValue({ events: [], answered: 0, attempted: 3 })
    await expect(pageReceipts('#p', PUBKEY)).rejects.toThrow(/no relay answered/)
  })

  it('returns empty when the relays answered and held nothing', async () => {
    queryWithStatus.mockResolvedValue(answered([]))
    await expect(pageReceipts('#p', PUBKEY)).resolves.toEqual([])
  })

  it('keeps what it has when a LATER page goes unanswered', async () => {
    queryWithStatus
      .mockResolvedValueOnce(answered([receipt('aa', 200), receipt('bb', 100)]))
      .mockResolvedValue({ events: [], answered: 0, attempted: 3 })
    const events = await pageReceipts('#p', PUBKEY)
    expect(events.map(event => event.id)).toEqual(['aa', 'bb'])
  })

  it('pages backwards with `until` and stops when a page adds nothing new', async () => {
    queryWithStatus
      .mockResolvedValueOnce(answered([receipt('aa', 200), receipt('bb', 100)]))
      .mockResolvedValueOnce(answered([receipt('bb', 100)]))
    const events = await pageReceipts('#p', PUBKEY)

    expect(events.map(event => event.id)).toEqual(['aa', 'bb'])
    expect(queryWithStatus).toHaveBeenCalledTimes(2)
    const second = queryWithStatus.mock.calls[1]?.[0] as Array<Record<string, unknown>>
    // One second below the oldest of the first page, so nothing is skipped and nothing.
    expect(second[0]?.['until']).toBe(99)
  })

  it('dedupes the same receipt arriving from several relays', async () => {
    queryWithStatus.mockResolvedValueOnce(answered([receipt('aa', 200), receipt('aa', 200)]))
    queryWithStatus.mockResolvedValue(answered([]))
    const events = await pageReceipts('#p', PUBKEY)
    expect(events).toHaveLength(1)
  })
})

/** Sats live in the invoice, not in the optional `amount` tag. */
describe('amountFromBolt11', () => {
  it('reads the common units', () => {
    expect(amountFromBolt11('lnbc210n1p...')).toBe(21)
    expect(amountFromBolt11('lnbc1u1p...')).toBe(100)
    expect(amountFromBolt11('lnbc10m1p...')).toBe(1_000_000)
  })

  it('is zero when there is no amount to read', () => {
    expect(amountFromBolt11('lnbc1p...')).toBe(0)
    expect(amountFromBolt11('')).toBe(0)
  })
})

/** A zap this account sent, and the pair of hashes that stop it being listed twice. */
describe('sentEntry', () => {
  // The BOLT-11 spec's "$24 for an entire list of things (hashed)" vector: 20m.
  const INVOICE =
    'lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qrsgq7ea976txfraylvgzuxs8kgcw23ezlrszfnh8r6qtfpr6cxga50aj6txm9rxrydzd06dfeawfk6swupvz4erwnyutnjq7x39ymw6j38gp7ynn44'
  const RECIPIENT = 'c'.repeat(64)
  const NOTE = 'e'.repeat(64)

  function outgoing(request: Record<string, unknown>, tags: string[][] = []): NostrEvent {
    return {
      id: 'receipt-1',
      pubkey: 'server'.padEnd(64, '0'),
      created_at: 5_000,
      kind: 9735,
      tags: [
        ['p', RECIPIENT],
        ['bolt11', INVOICE],
        ['description', JSON.stringify(request)],
        ...tags,
      ],
      content: '',
      sig: '0'.repeat(128),
    }
  }

  it('carries both invoice hashes so the wallet ledger can pair with it', () => {
    const entry = sentEntry(outgoing({ pubkey: PUBKEY, content: '' }), PUBKEY)
    expect(entry?.paymentHash).toBe('0001020304050607080900010203040506070809000102030405060708090102')
    expect(entry?.descriptionHash).toBe('3925b6f67e2c340036ed12093dd44e0368df1b6ea26c53dbe4811f58fd5db8c1')
  })

  it('reads the counterparty, the amount and the note it paid for', () => {
    const entry = sentEntry(outgoing({ pubkey: PUBKEY, content: ' thanks ' }, [['e', NOTE]]), PUBKEY)
    expect(entry).toMatchObject({
      counterparty: RECIPIENT,
      sats: 2_000_000,
      comment: 'thanks',
      eventId: NOTE,
      createdAt: 5_000,
      senderVerified: true,
    })
  })

  it("refuses somebody else's zap, whoever the receipt is addressed to", () => {
    expect(sentEntry(outgoing({ pubkey: 'f'.repeat(64), content: '' }), PUBKEY)).toBeNull()
  })

  it('refuses a receipt with nothing to attribute', () => {
    const noDescription: NostrEvent = {
      ...outgoing({ pubkey: PUBKEY }),
      tags: [['p', RECIPIENT], ['bolt11', INVOICE]],
    }
    expect(sentEntry(noDescription, PUBKEY)).toBeNull()

    const broken: NostrEvent = {
      ...outgoing({ pubkey: PUBKEY }),
      tags: [['p', RECIPIENT], ['bolt11', INVOICE], ['description', 'not json']],
    }
    expect(sentEntry(broken, PUBKEY)).toBeNull()
  })

  it('refuses an invoice with no amount rather than listing a zero-sat zap', () => {
    const amountless: NostrEvent = {
      ...outgoing({ pubkey: PUBKEY }),
      tags: [
        ['p', RECIPIENT],
        ['bolt11', 'lnbc1pvjluezpp5qqqsyq'],
        ['description', JSON.stringify({ pubkey: PUBKEY })],
      ],
    }
    expect(sentEntry(amountless, PUBKEY)).toBeNull()
  })

  it('omits an empty comment instead of carrying a blank one', () => {
    const entry = sentEntry(outgoing({ pubkey: PUBKEY, content: '   ' }), PUBKEY)
    expect(entry).not.toHaveProperty('comment')
  })
})

/** A SHORT PAGE IS NOT THE END OF HISTORY. */
describe('paging stops only when the network says so', () => {
  it('keeps asking when a page came back empty and nobody answered', async () => {
    queryWithStatus
      .mockResolvedValueOnce(answered([receipt('aa', 300), receipt('bb', 200)]))
      // A timeout wearing an empty page's clothes: no events, and no EOSE either.
      .mockResolvedValueOnce({ events: [], answered: 0, attempted: 4 })
      .mockResolvedValueOnce(answered([receipt('cc', 100)]))
      .mockResolvedValue(answered([]))

    const events = await pageReceipts('#p', PUBKEY)
    expect(events.map(e => e.id).sort()).toEqual(['aa', 'bb', 'cc'])
  })

  it('stops when relays answered and genuinely had nothing more', async () => {
    queryWithStatus
      .mockResolvedValueOnce(answered([receipt('aa', 300)]))
      .mockResolvedValueOnce(answered([]))
      .mockResolvedValue(answered([receipt('never', 10)]))

    const events = await pageReceipts('#p', PUBKEY)
    // The walk ended at the empty page.
    expect(events.map(e => e.id)).toEqual(['aa'])
  })

  it('stops rather than looping when only one relay exists and it answered', async () => {
    // `attempted: 1` cannot reach a quorum of two, so the rule falls back to what is there.
    queryWithStatus
      .mockResolvedValueOnce({ events: [receipt('aa', 300)], answered: 1, attempted: 1 })
      .mockResolvedValue({ events: [], answered: 1, attempted: 1 })

    const events = await pageReceipts('#p', PUBKEY)
    expect(events.map(e => e.id)).toEqual(['aa'])
  })

  it('gives up after the page cap rather than spinning on silence', async () => {
    // Every page unanswered: the loop must still terminate, with whatever the first page.
    queryWithStatus
      .mockResolvedValueOnce(answered([receipt('aa', 300)]))
      .mockResolvedValue({ events: [], answered: 0, attempted: 4 })

    const events = await pageReceipts('#p', PUBKEY)
    expect(events.map(e => e.id)).toEqual(['aa'])
    // Six pages, no more: MAX_PAGES is the backstop.
    expect(queryWithStatus.mock.calls.length).toBeLessThanOrEqual(6)
  })
})
