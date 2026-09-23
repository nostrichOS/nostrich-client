import { describe, expect, it } from 'vitest'
import { npubEncode } from 'nostr-tools/nip19'

import { fetchAuthorWriteRelays, fetchEventByPointer, quotedAuthorFromTags } from './fetch-event'
import type { EventQuerier } from './fetch-event'
import type { Hex, NostrEvent, RelayUrl } from './types'

const hex = (seed: string): Hex => seed.repeat(32).slice(0, 64) as Hex

const TARGET = hex('d0')
const OTHER = hex('e1')
const AUTHOR = hex('36')
const ASKER = hex('4d')

function event(overrides: Partial<NostrEvent> & Pick<NostrEvent, 'id'>): NostrEvent {
  return {
    pubkey: AUTHOR,
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: '',
    sig: '0'.repeat(128),
    ...overrides,
  }
}

function relayList(urls: string[], createdAt = 1_700_000_000): NostrEvent {
  return event({
    id: hex('aa'),
    kind: 10002,
    created_at: createdAt,
    tags: urls.map(url => ['r', url]),
  })
}

/** A querier that answers per relay set, and records every call. */
function querier(
  answer: (filters: unknown[], relays: RelayUrl[] | undefined) => NostrEvent[],
): EventQuerier & { calls: { filters: unknown[]; relays: RelayUrl[] | undefined }[] } {
  const calls: { filters: unknown[]; relays: RelayUrl[] | undefined }[] = []
  return {
    calls,
    query(filters: unknown[], relays?: RelayUrl[]): Promise<NostrEvent[]> {
      calls.push({ filters, relays })
      return Promise.resolve(answer(filters, relays))
    },
  }
}

const filterKinds = (filters: unknown[]): number[] =>
  ((filters[0] as { kinds?: number[] }).kinds ?? [])

describe('fetchEventByPointer', () => {
  it('takes the event from our own relays without any outbox lookup', async () => {
    const pool = querier(() => [event({ id: TARGET })])
    const found = await fetchEventByPointer(pool, { id: TARGET, author: AUTHOR })

    expect(found?.id).toBe(TARGET)
    expect(pool.calls).toHaveLength(1)
    expect(pool.calls[0]?.relays).toBeUndefined()
  })

  it('prefers the pointer relay hints over our own relays', async () => {
    const pool = querier((_filters, relays) =>
      relays?.includes('wss://hinted.example' as RelayUrl) === true ? [event({ id: TARGET })] : [],
    )
    const found = await fetchEventByPointer(pool, {
      id: TARGET,
      relays: ['wss://hinted.example'] as RelayUrl[],
    })

    expect(found?.id).toBe(TARGET)
    expect(pool.calls[0]?.relays).toEqual(['wss://hinted.example'])
  })

  /** The bug this module exists for: a note that is on nobody's relays but its author's. */
  it("falls through to the author's own write relays", async () => {
    const pool = querier((filters, relays) => {
      if (filterKinds(filters).includes(10002)) return [relayList(['wss://relay-d.example'])]
      if (relays?.includes('wss://relay-d.example' as RelayUrl) === true) return [event({ id: TARGET })]
      return []
    })

    const found = await fetchEventByPointer(pool, { id: TARGET, author: AUTHOR })

    expect(found?.id).toBe(TARGET)
    // Ours, then the relay-list lookup, then the author's own relay.
    expect(pool.calls.map(call => call.relays)).toEqual([
      undefined,
      undefined,
      ['wss://relay-d.example'],
    ])
  })

  it('does not chase an author it was never given', async () => {
    const pool = querier(() => [])
    expect(await fetchEventByPointer(pool, { id: TARGET })).toBeUndefined()
    // One call: nothing to look up, so no relay-list query either.
    expect(pool.calls).toHaveLength(1)
  })

  it('gives up when the author announces no write relays', async () => {
    const pool = querier(() => [])
    expect(await fetchEventByPointer(pool, { id: TARGET, author: AUTHOR })).toBeUndefined()
    expect(pool.calls).toHaveLength(2)
  })

  /** A relay answering an id filter with a different event must not fill the quote card. */
  it('refuses an event that is not the one asked for', async () => {
    const pool = querier(() => [event({ id: OTHER })])
    expect(await fetchEventByPointer(pool, { id: TARGET })).toBeUndefined()
  })

  it('never opens a socket to the reader own network', async () => {
    const pool = querier(filters =>
      filterKinds(filters).includes(10002)
        ? [relayList(['ws://192.168.1.9:4869', 'ws://localhost:7777', 'wss://good.example'])]
        : [],
    )
    await fetchEventByPointer(pool, { id: TARGET, author: AUTHOR })

    expect(pool.calls.at(-1)?.relays).toEqual(['wss://good.example'])
  })

  it('does not re-ask a relay the hints already covered', async () => {
    const pool = querier(filters =>
      filterKinds(filters).includes(10002) ? [relayList(['wss://hinted.example'])] : [],
    )
    await fetchEventByPointer(pool, {
      id: TARGET,
      author: AUTHOR,
      relays: ['wss://hinted.example'] as RelayUrl[],
    })

    // Hints, our own relays, the relay-list lookup.
    expect(pool.calls.map(call => call.relays)).toEqual([
      ['wss://hinted.example'],
      undefined,
      undefined,
    ])
  })

  /** A hint is a guess somebody wrote months ago about where another person's note would. */
  it('still asks our own relays after a stale hint misses', async () => {
    const pool = querier((_filters, relays) => (relays === undefined ? [event({ id: TARGET })] : []))
    const found = await fetchEventByPointer(pool, {
      id: TARGET,
      relays: ['wss://moved-on.example'] as RelayUrl[],
    })

    expect(found?.id).toBe(TARGET)
  })

  it('resolves write relays through the caller hook when one is given', async () => {
    const pool = querier((_filters, relays) =>
      relays?.includes('wss://cached.example' as RelayUrl) === true ? [event({ id: TARGET })] : [],
    )
    const found = await fetchEventByPointer(
      pool,
      { id: TARGET, author: AUTHOR },
      { writeRelaysFor: () => Promise.resolve(['wss://cached.example'] as RelayUrl[]) },
    )

    expect(found?.id).toBe(TARGET)
    // No relay-list query at all: the caller's cache answered.
    expect(pool.calls.filter(call => filterKinds(call.filters).includes(10002))).toHaveLength(0)
  })
})

describe('fetchAuthorWriteRelays', () => {
  it('takes the newest relay list and ignores older copies', async () => {
    const pool = querier(() => [
      relayList(['wss://old.example'], 1_600_000_000),
      relayList(['wss://new.example'], 1_800_000_000),
    ])
    expect(await fetchAuthorWriteRelays(pool, AUTHOR)).toEqual(['wss://new.example'])
  })

  it('ignores a relay list attributed to somebody else', async () => {
    const pool = querier(() => [{ ...relayList(['wss://wrong.example']), pubkey: OTHER }])
    expect(await fetchAuthorWriteRelays(pool, AUTHOR)).toEqual([])
  })

  it('honours read-only markers by excluding them', async () => {
    const pool = querier(() => [
      event({
        id: hex('bb'),
        kind: 10002,
        tags: [
          ['r', 'wss://inbox.example', 'read'],
          ['r', 'wss://outbox.example', 'write'],
        ],
      }),
    ])
    expect(await fetchAuthorWriteRelays(pool, AUTHOR)).toEqual(['wss://outbox.example'])
  })

  /** Neither source is reliable on its own. */
  it('asks the indexers as well as our own relays', async () => {
    const pool = querier((_filters, relays) =>
      relays?.includes('wss://user.kindpag.es' as RelayUrl) === true
        ? [relayList(['wss://only-the-indexer-knew.example'])]
        : [],
    )
    const relays = await fetchAuthorWriteRelays(pool, AUTHOR, {
      indexers: ['wss://user.kindpag.es'] as RelayUrl[],
    })

    expect(relays).toEqual(['wss://only-the-indexer-knew.example'])
    expect(pool.calls).toHaveLength(2)
  })

  it('prefers the newest list wherever it came from', async () => {
    const pool = querier((_filters, relays) =>
      relays === undefined
        ? [relayList(['wss://stale.example'], 1_600_000_000)]
        : [relayList(['wss://current.example'], 1_800_000_000)],
    )
    expect(
      await fetchAuthorWriteRelays(pool, AUTHOR, { indexers: ['wss://user.kindpag.es'] as RelayUrl[] }),
    ).toEqual(['wss://current.example'])
  })
})

describe('quotedAuthorFromTags', () => {
  it('reads the pubkey off a NIP-18 q tag', () => {
    const note = event({ id: hex('01'), tags: [['q', TARGET, '', AUTHOR]] })
    expect(quotedAuthorFromTags(note, TARGET)).toBe(AUTHOR)
  })

  it('reads the fifth element of a NIP-10 e tag', () => {
    const note = event({ id: hex('02'), tags: [['e', TARGET, '', 'mention', AUTHOR]] })
    expect(quotedAuthorFromTags(note, TARGET)).toBe(AUTHOR)
  })

  /** The shape one iOS client actually writes. */
  it('falls back to a single p tag marked mention', () => {
    const note = event({
      id: hex('03'),
      tags: [
        ['e', TARGET, '', 'mention'],
        ['p', AUTHOR, '', 'mention'],
      ],
    })
    expect(quotedAuthorFromTags(note, TARGET)).toBe(AUTHOR)
  })

  it('refuses to guess when several people are p-tagged as mentions', () => {
    const note = event({
      id: hex('04'),
      tags: [
        ['p', AUTHOR, '', 'mention'],
        ['p', ASKER, '', 'mention'],
      ],
    })
    expect(quotedAuthorFromTags(note, TARGET)).toBeUndefined()
  })

  it('refuses to guess on a reply, where p tags are thread participants', () => {
    const note = event({
      id: hex('05'),
      tags: [
        ['e', hex('99'), '', 'root'],
        ['p', AUTHOR],
        ['p', ASKER],
      ],
    })
    expect(quotedAuthorFromTags(note, TARGET)).toBeUndefined()
  })

  it('uses a lone p tag on a top-level note', () => {
    const note = event({ id: hex('07'), tags: [['p', AUTHOR]] })
    expect(quotedAuthorFromTags(note, TARGET)).toBe(AUTHOR)
  })

  /** The shape this app's own composer produces: an inline @-mention becomes a bare p. */
  it('does not mistake somebody @-mentioned in the body for the person quoted', () => {
    const note = event({
      id: hex('09'),
      content: `hey nostr:${npubEncode(ASKER)} look at this`,
      tags: [
        ['p', ASKER],
        ['q', TARGET],
      ],
    })
    expect(quotedAuthorFromTags(note, TARGET)).toBeUndefined()
  })

  it('ignores an @-mention when deciding between marked p tags', () => {
    const note = event({
      id: hex('0a'),
      content: `nostr:${npubEncode(ASKER)} see this`,
      tags: [
        ['p', ASKER, '', 'mention'],
        ['p', AUTHOR, '', 'mention'],
      ],
    })
    // Only one of the two is unexplained by the body, so it is no longer ambiguous.
    expect(quotedAuthorFromTags(note, TARGET)).toBe(AUTHOR)
  })

  it('will not read the person being replied to as the person quoted', () => {
    const note = event({
      id: hex('08'),
      tags: [
        ['e', hex('99'), '', 'root'],
        ['p', ASKER],
      ],
    })
    expect(quotedAuthorFromTags(note, TARGET)).toBeUndefined()
  })

  it('ignores a q tag pointing at a different event', () => {
    const note = event({ id: hex('06'), tags: [['q', OTHER, '', ASKER]] })
    expect(quotedAuthorFromTags(note, TARGET)).toBeUndefined()
  })
})
