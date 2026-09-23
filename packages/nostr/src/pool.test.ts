import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createPool,
  NostrichPool,
  SeenIds,
  type NostrichPoolOptions,
  type UnderlyingPool,
  type UnderlyingRelay,
  type UnderlyingSubscribeParams,
  type UnderlyingSubscription,
} from './pool'
import {
  DEFAULT_INDEXER_RELAYS,
  DEFAULT_RELAYS,
  buildRelayListEvent,
  buildRelayListTags,
  inboxRelaysForAuthor,
  normalizeRelayUrl,
  normalizeRelayUrls,
  parseRelayList,
  publishRelays,
  readRelaysForAuthor,
  relayUrlsEqual,
  selectOutboxRelays,
  type RelayEntry,
} from './relays'
import type { Filter, Hex, NostrEvent, RelayList, RelayUrl } from './types'

// --------------------------------------------------------------------------- Fakes.

class FakeSubscription implements UnderlyingSubscription {
  closed = false

  constructor(
    private readonly relay: FakeRelay,
    readonly params: UnderlyingSubscribeParams,
  ) {}

  // nostr-tools invokes onclose for a locally-closed subscription too, which is exactly.
  close(reason = 'closed by caller'): void {
    if (this.closed) return
    this.closed = true
    this.relay.detach(this)
    this.params.onclose?.(reason)
  }
}

class FakeRelay implements UnderlyingRelay {
  connected = true
  subs: FakeSubscription[] = []
  filters: Filter[][] = []
  published: NostrEvent[] = []
  publishOk = ''
  publishError: string | undefined
  publishHangs = false
  /** undefined = this relay does not implement NIP-45, which is the common case. */
  countAnswer: number | undefined
  countRejects = false
  countHangs = false
  counted: Filter[][] = []

  constructor(readonly url: string) {}

  subscribe(filters: Filter[], params: UnderlyingSubscribeParams): UnderlyingSubscription {
    this.filters.push(filters)
    const sub = new FakeSubscription(this, params)
    this.subs.push(sub)
    return sub
  }

  count = async (filters: Filter[]): Promise<number> => {
    this.counted.push(filters)
    if (this.countHangs) return new Promise<number>(() => {})
    if (this.countRejects) throw new Error('COUNT not supported')
    if (this.countAnswer === undefined) throw new Error('no answer')
    return this.countAnswer
  }

  detach(sub: FakeSubscription): void {
    this.subs = this.subs.filter(candidate => candidate !== sub)
  }

  /** Raw delivery: the fake ignores `alreadyHaveEvent` so the pool's own dedup. */
  emit(event: NostrEvent): void {
    for (const sub of [...this.subs]) sub.params.onevent?.(event)
  }

  eose(): void {
    for (const sub of [...this.subs]) sub.params.oneose?.()
  }

  drop(reason = 'relay connection closed'): void {
    const subs = [...this.subs]
    this.subs = []
    for (const sub of subs) {
      sub.closed = true
      sub.params.onclose?.(reason)
    }
  }

  async publish(event: NostrEvent): Promise<string> {
    this.published.push(event)
    if (this.publishHangs) return new Promise<string>(() => {})
    if (this.publishError !== undefined) throw new Error(this.publishError)
    return this.publishOk
  }

  close(): void {
    this.connected = false
  }
}

class FakePool implements UnderlyingPool {
  readonly relays = new Map<string, FakeRelay>()
  readonly closedUrls: string[] = []
  readonly unreachable = new Set<string>()
  readonly ensureCalls: string[] = []

  async ensureRelay(url: string): Promise<UnderlyingRelay> {
    this.ensureCalls.push(url)
    if (this.unreachable.has(url)) throw new Error(`failed to connect to ${url}`)
    return this.seed(url)
  }

  close(urls: string[]): void {
    this.closedUrls.push(...urls)
  }

  seed(url: string): FakeRelay {
    let relay = this.relays.get(url)
    if (relay === undefined) {
      relay = new FakeRelay(url)
      this.relays.set(url, relay)
    }
    return relay
  }

  at(url: string): FakeRelay {
    const relay = this.relays.get(url)
    if (relay === undefined) throw new Error(`no fake relay for ${url}`)
    return relay
  }

  connectionsTo(url: string): number {
    return this.ensureCalls.filter(candidate => candidate === url).length
  }
}

const A = 'wss://a.example'
const B = 'wss://b.example'
const C = 'wss://c.example'
const ALL = [A, B, C]

function readWrite(...urls: string[]): RelayEntry[] {
  return urls.map(url => ({ url, policy: { read: true, write: true } }))
}

function note(id: string): NostrEvent {
  return {
    id,
    pubkey: 'f'.repeat(64),
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: id,
    sig: '0'.repeat(128),
  }
}

function makePool(overrides: NostrichPoolOptions = {}): { pool: NostrichPool; underlying: FakePool } {
  const underlying = new FakePool()
  const pool = new NostrichPool({
    underlying,
    relays: readWrite(...ALL),
    eoseTimeoutMs: 1_000,
    connectTimeoutMs: 1_000,
    publishTimeoutMs: 2_000,
    queryTimeoutMs: 30_000,
    reconnectBaseMs: 1_000,
    reconnectMaxMs: 60_000,
    random: () => 0,
    ...overrides,
  })
  return { pool, underlying }
}

/** Advance fake time and let every pending promise job run. */
async function settle(ms = 1): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

// --------------------------------------------------------------------------- URL.

describe('normalizeRelayUrl', () => {
  it.each([
    ['wss://Relay-A.Example/', 'wss://relay-a.example'],
    ['  wss://relay-a.example  ', 'wss://relay-a.example'],
    ['relay-a.example', 'wss://relay-a.example'],
    ['https://relay.example.com', 'wss://relay.example.com'],
    ['http://relay.example.com', 'wss://relay.example.com'],
    ['ws://relay.example.com', 'wss://relay.example.com'],
    ['wss://relay.example.com:443', 'wss://relay.example.com'],
    ['wss://relay.example.com:443/', 'wss://relay.example.com'],
    ['http://relay.example.com:80', 'wss://relay.example.com'],
    ['wss://relay.example.com:7777', 'wss://relay.example.com:7777'],
    ['wss://relay.example.com//nostr//', 'wss://relay.example.com/nostr'],
    ['wss://Relay.Example.com/Inbox', 'wss://relay.example.com/Inbox'],
    ['wss://relay.example.com/inbox#anchor', 'wss://relay.example.com/inbox'],
    ['wss://relay.example.com/?b=2&a=1', 'wss://relay.example.com?a=1&b=2'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeRelayUrl(input)).toBe(expected)
  })

  it('keeps plaintext ws:// for local relays only', () => {
    expect(normalizeRelayUrl('ws://localhost:7777')).toBe('ws://localhost:7777')
    expect(normalizeRelayUrl('localhost:7777')).toBe('ws://localhost:7777')
    expect(normalizeRelayUrl('ws://127.0.0.1:8080/')).toBe('ws://127.0.0.1:8080')
    expect(normalizeRelayUrl('ws://relay-box.local:4848')).toBe('ws://relay-box.local:4848')
    // An explicit wss:// on localhost is honoured.
    expect(normalizeRelayUrl('wss://localhost:8080')).toBe('wss://localhost:8080')
  })

  it.each(['', '   ', 'wss://', 'ftp://relay.example.com'])('rejects %j', input => {
    expect(() => normalizeRelayUrl(input)).toThrow(TypeError)
  })

  it('collapses spellings of the same relay to one entry', () => {
    expect(
      normalizeRelayUrls(['wss://A.example/', 'wss://a.example', 'ws://a.example', 'wss://', B]),
    ).toEqual([A, B])
  })

  it('compares relays by their normalised form', () => {
    expect(relayUrlsEqual('wss://A.example/', 'a.example')).toBe(true)
    expect(relayUrlsEqual(A, B)).toBe(false)
    expect(relayUrlsEqual('wss://', A)).toBe(false)
  })
})

// --------------------------------------------------------------------------- NIP-65.

describe('NIP-65 relay lists', () => {
  function relayListEvent(tags: string[][], createdAt = 1_700_000_000): NostrEvent {
    return {
      id: '1'.repeat(64),
      pubkey: 'a'.repeat(64),
      created_at: createdAt,
      kind: 10002,
      tags,
      content: '',
      sig: '0'.repeat(128),
    }
  }

  it('reads markers, and treats a bare r tag as read AND write', () => {
    const list = parseRelayList(
      relayListEvent([
        ['r', 'wss://Relay-A.Example/'],
        ['r', 'wss://inbox.example.com', 'read'],
        ['r', 'wss://outbox.example.com', 'write'],
      ]),
    )
    expect(list.updatedAt).toBe(1_700_000_000)
    expect(list.entries).toEqual([
      { url: 'wss://relay-a.example', policy: { read: true, write: true } },
      { url: 'wss://inbox.example.com', policy: { read: true, write: false } },
      { url: 'wss://outbox.example.com', policy: { read: false, write: true } },
    ])
  })

  it('unions a relay tagged twice with opposite markers', () => {
    const list = parseRelayList(
      relayListEvent([
        ['r', 'wss://both.example.com', 'read'],
        ['r', 'wss://both.example.com/', 'write'],
      ]),
    )
    expect(list.entries).toEqual([{ url: 'wss://both.example.com', policy: { read: true, write: true } }])
  })

  it('keeps relays with an unknown marker rather than dropping the author', () => {
    const list = parseRelayList(relayListEvent([['r', 'wss://weird.example.com', 'sometimes']]))
    expect(list.entries).toEqual([
      { url: 'wss://weird.example.com', policy: { read: true, write: true } },
    ])
  })

  it('skips junk tags without failing the whole list', () => {
    const list = parseRelayList(
      relayListEvent([
        ['r'],
        ['r', ''],
        ['r', 'ftp://nope.example.com'],
        ['p', 'a'.repeat(64)],
        ['r', 'wss://good.example.com'],
      ]),
    )
    expect(list.entries).toEqual([{ url: 'wss://good.example.com', policy: { read: true, write: true } }])
  })

  it('refuses any kind other than 10002', () => {
    // The classic mistake is a kind-3 contact list, whose legacy content blob also held.
    const contacts: NostrEvent = { ...relayListEvent([['r', A]]), kind: 3 }
    expect(() => parseRelayList(contacts)).toThrow(TypeError)
  })

  it('round-trips through tags, emitting a bare r tag for read+write', () => {
    const entries: RelayEntry[] = [
      { url: 'wss://both.example.com', policy: { read: true, write: true } },
      { url: 'wss://inbox.example.com', policy: { read: true, write: false } },
      { url: 'wss://outbox.example.com', policy: { read: false, write: true } },
      { url: 'wss://off.example.com', policy: { read: false, write: false } },
    ]
    const tags = buildRelayListTags(entries)
    expect(tags).toEqual([
      ['r', 'wss://both.example.com'],
      ['r', 'wss://inbox.example.com', 'read'],
      ['r', 'wss://outbox.example.com', 'write'],
    ])
    expect(parseRelayList(relayListEvent(tags)).entries).toEqual(entries.slice(0, 3))
  })

  it('builds an empty-content kind 10002', () => {
    const template = buildRelayListEvent(readWrite(A), 1_234)
    expect(template).toEqual({ kind: 10002, created_at: 1_234, content: '', tags: [['r', A]] })
  })
})

// --------------------------------------------------------------------------- Relay.

describe('default relay sets', () => {
  it('ships exactly the note-serving relays, in order', () => {
    // A default list is a starting point, not a policy: a reader replaces.
    expect([...DEFAULT_RELAYS]).toEqual([
      'wss://nos.lol',
      'wss://nostr.mom',
    ])
  })

  it('is already normalised, so the pool cannot open a second socket for a variant spelling', () => {
    expect(normalizeRelayUrls(DEFAULT_RELAYS)).toEqual([...DEFAULT_RELAYS])
    expect(normalizeRelayUrls(DEFAULT_INDEXER_RELAYS)).toEqual([...DEFAULT_INDEXER_RELAYS])
  })

  it('keeps the kind-0-only indexer out of the feed read set', () => {
    // A profile indexer answers no kind-1 query.
    expect(DEFAULT_RELAYS).not.toContain('wss://user.kindpag.es')
    expect(DEFAULT_INDEXER_RELAYS).toContain('wss://user.kindpag.es')
  })

  it('does not carry purplepag.es, removed by operator decision', () => {
    // Removed on request 2026-08-15. Recorded as a test because it is the network's main.
    expect(DEFAULT_RELAYS).not.toContain('wss://purplepag.es')
    expect(DEFAULT_INDEXER_RELAYS).not.toContain('wss://purplepag.es')
  })
})

describe('relay selection', () => {
  const list: RelayList = {
    updatedAt: 1,
    entries: [
      { url: 'wss://both.example.com', policy: { read: true, write: true } },
      { url: 'wss://inbox.example.com', policy: { read: true, write: false } },
      { url: 'wss://outbox.example.com', policy: { read: false, write: true } },
    ],
  }

  it('publishes to the write set', () => {
    expect(publishRelays(list)).toEqual(['wss://both.example.com', 'wss://outbox.example.com'])
  })

  it('reads an author from their WRITE relays, not their read relays', () => {
    expect(readRelaysForAuthor(list)).toEqual(['wss://both.example.com', 'wss://outbox.example.com'])
    expect(readRelaysForAuthor(list)).not.toContain('wss://inbox.example.com')
  })

  it('addresses an author on their READ relays', () => {
    expect(inboxRelaysForAuthor(list)).toEqual(['wss://both.example.com', 'wss://inbox.example.com'])
  })

  it('falls back and caps', () => {
    expect(publishRelays(undefined)).toEqual([...DEFAULT_RELAYS])
    expect(publishRelays(undefined, { fallback: [A, B], max: 1 })).toEqual([A])
    expect(publishRelays(list, { max: 1 })).toEqual(['wss://both.example.com'])
  })
})

describe('selectOutboxRelays', () => {
  const R1 = 'wss://r1.example'
  const R2 = 'wss://r2.example'
  const R3 = 'wss://r3.example'
  const a1 = '1'.repeat(64)
  const a2 = '2'.repeat(64)
  const a3 = '3'.repeat(64)
  const a4 = '4'.repeat(64)

  function writeList(...urls: string[]): RelayList {
    return { updatedAt: 1, entries: urls.map(url => ({ url, policy: { read: false, write: true } })) }
  }

  const lists = new Map<Hex, RelayList>([
    [a1, writeList(R1, R2)],
    [a2, writeList(R1, R3)],
    [a3, writeList(R1, R2)],
  ])

  it('covers every author with one relay when redundancy is 1', () => {
    const selection = selectOutboxRelays([a1, a2, a3, a4], lists, { redundancy: 1 })
    expect(selection.relays).toEqual([R1])
    expect(selection.byRelay.get(R1)).toEqual([a1, a2, a3])
    expect(selection.uncovered).toEqual([a4])
  })

  it('adds relays until every author is carried by two of them', () => {
    const selection = selectOutboxRelays([a1, a2, a3], lists, { redundancy: 2 })
    expect(selection.relays).toEqual([R1, R2, R3])
    expect(selection.uncovered).toEqual([])
  })

  it('breaks ties deterministically so the socket set is stable', () => {
    const alpha = 'wss://alpha.example'
    const zeta = 'wss://zeta.example'
    const tied = new Map<Hex, RelayList>([
      [a1, writeList(zeta, alpha)],
      [a2, writeList(zeta, alpha)],
    ])
    expect(selectOutboxRelays([a1, a2], tied, { redundancy: 1 }).relays).toEqual([alpha])
  })

  it('reports authors squeezed out by the socket ceiling', () => {
    const split = new Map<Hex, RelayList>([
      [a1, writeList(R1)],
      [a2, writeList(R2)],
    ])
    const selection = selectOutboxRelays([a1, a2], split, { maxTotal: 1, redundancy: 1 })
    expect(selection.relays).toHaveLength(1)
    expect(selection.uncovered).toEqual([a2])
  })

  it('ignores the long tail of an oversized relay list', () => {
    const many = new Map<Hex, RelayList>([[a1, writeList(R1, R2, R3, 'wss://r4.example')]])
    const selection = selectOutboxRelays([a1], many, { maxPerAuthor: 2, redundancy: 2 })
    expect(selection.relays).toEqual([R1, R2])
  })
})

// --------------------------------------------------------------------------- SeenIds.

describe('SeenIds', () => {
  it('reports an id as new exactly once', () => {
    const seen = new SeenIds(10)
    expect(seen.add('a')).toBe(true)
    expect(seen.add('a')).toBe(false)
  })

  it('evicts the least recently seen id at the cap', () => {
    const seen = new SeenIds(2)
    seen.add('a')
    seen.add('b')
    seen.add('a') // touching 'a' makes 'b' the eviction candidate
    seen.add('c')
    expect(seen.size).toBe(2)
    expect(seen.has('a')).toBe(true)
    expect(seen.has('b')).toBe(false)
    expect(seen.has('c')).toBe(true)
  })
})

// --------------------------------------------------------------------------- Pool.

describe('NostrichPool', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers an event once however many relays carry it', async () => {
    const { pool, underlying } = makePool()
    const delivered: Array<[string, string]> = []
    pool.subscribe({
      filters: [{ kinds: [1] }],
      onEvent: (event, relay) => {
        delivered.push([event.id, relay])
      },
    })
    await settle()

    const shared = note('aa')
    for (const url of ALL) underlying.at(url).emit(shared)

    expect(delivered).toEqual([['aa', A]])
  })

  it('still delivers distinct events from every relay', async () => {
    const { pool, underlying } = makePool()
    const ids: string[] = []
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: event => void ids.push(event.id) })
    await settle()

    underlying.at(A).emit(note('aa'))
    underlying.at(B).emit(note('aa'))
    underlying.at(B).emit(note('bb'))
    underlying.at(C).emit(note('cc'))

    expect(ids).toEqual(['aa', 'bb', 'cc'])
  })

  it('lets an id through again once the bounded cache has evicted it', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A), seenCap: 2 })
    const ids: string[] = []
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: event => void ids.push(event.id) })
    await settle()

    const relay = underlying.at(A)
    relay.emit(note('aa'))
    relay.emit(note('bb'))
    relay.emit(note('cc'))
    relay.emit(note('aa'))

    expect(ids).toEqual(['aa', 'bb', 'cc', 'aa'])
  })

  it('dedups per subscription, so a later subscription still sees the event', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A) })
    const first: string[] = []
    const second: string[] = []
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: event => void first.push(event.id) })
    await settle()
    underlying.at(A).emit(note('aa'))

    pool.subscribe({ filters: [{ ids: ['aa'] }], onEvent: event => void second.push(event.id) })
    await settle()
    underlying.at(A).emit(note('aa'))

    expect(first).toEqual(['aa'])
    expect(second).toEqual(['aa'])
  })

  it('fires onEose once, after the last relay has EOSEd', async () => {
    const { pool, underlying } = makePool()
    let eoses = 0
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {}, onEose: () => void (eoses += 1) })
    await settle()

    underlying.at(A).eose()
    underlying.at(B).eose()
    expect(eoses).toBe(0)

    underlying.at(C).eose()
    expect(eoses).toBe(1)

    underlying.at(A).eose()
    expect(eoses).toBe(1)
  })

  it('fires onEose on the per-relay timeout when one relay goes quiet', async () => {
    const { pool, underlying } = makePool()
    let eoses = 0
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {}, onEose: () => void (eoses += 1) })
    await settle()

    underlying.at(A).eose()
    underlying.at(B).eose()
    expect(eoses).toBe(0)

    await settle(1_000)
    expect(eoses).toBe(1)
  })

  it('does not let an unreachable relay hold EOSE', async () => {
    const { pool, underlying } = makePool()
    underlying.unreachable.add(C)
    let eoses = 0
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {}, onEose: () => void (eoses += 1) })
    await settle()

    underlying.at(A).eose()
    underlying.at(B).eose()
    expect(eoses).toBe(1)
    expect(pool.status().find(status => status.url === C)?.state).toBe('failed')
  })

  it('keeps the feed alive when one relay refuses the subscription', async () => {
    // a paid relay answers an unauthenticated REQ with CLOSED.
    const { pool, underlying } = makePool()
    const delivered: string[] = []
    let eoses = 0
    pool.subscribe({
      filters: [{ kinds: [1] }],
      onEvent: event => void delivered.push(event.id),
      onEose: () => void (eoses += 1),
    })
    await settle()

    underlying.at(C).drop('auth-required: we only serve paying members')
    underlying.at(A).emit(note('aa'))
    underlying.at(A).eose()
    underlying.at(B).eose()
    await settle()

    expect(delivered).toEqual(['aa'])
    expect(eoses).toBe(1)
    const refused = pool.status().find(status => status.url === C)
    expect(refused?.error).toContain('auth-required')
    pool.close()
  })

  it('stops retrying a subscription the relay REFUSED, without giving up the relay', async () => {
    /* The 220-REQ loop, in miniature. */
    const { pool, underlying } = makePool()
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    await settle()
    const before = underlying.at(C).filters.length

    underlying.at(C).drop("auth-required: we can't serve DMs to unauthenticated users")
    // Far longer than any backoff would have waited.
    await settle(120_000)
    expect(underlying.at(C).filters.length).toBe(before)

    // The RELAY is untouched: a refusal of one subscription must not cost the next one.
    pool.subscribe({ filters: [{ kinds: [30023] }], onEvent: () => {} })
    await settle()
    expect(underlying.at(C).filters.length).toBe(before + 1)
    pool.close()
  })

  it('still reconnects a subscription the relay merely DROPPED', async () => {
    // The other half of the split, and the reason `isPermanentRefusal` defaults to false.
    const { pool, underlying } = makePool()
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    await settle()
    const before = underlying.at(C).filters.length

    underlying.at(C).drop('rate-limited: slow down')
    await settle(120_000)
    expect(underlying.at(C).filters.length).toBeGreaterThan(before)
    pool.close()
  })

  it('resolves once the stream goes quiet, without waiting for a stalled relay', async () => {
    /* The fix for a pattern that had been hand-rolled at four call sites. */
    const { pool, underlying } = makePool({ eoseTimeoutMs: 10_000 })
    let done = false
    const outcome = pool.queryWithStatus([{ kinds: [1] }], undefined, 30_000, { graceMs: 300 })
    void outcome.then(() => {
      done = true
    })
    await settle()

    underlying.at(A).emit(note('aa'))
    underlying.at(A).eose()
    underlying.at(B).eose()
    // C never answers.
    await settle(400)

    expect(done).toBe(true)
    const result = await outcome
    expect(result.events.map(event => event.id)).toEqual(['aa'])
    expect(result.answered).toBe(2)
    pool.close()
  })

  it('does not cut off a relay that is slow but still sending', async () => {
    // The grace restarts on every event, so "slow" and "finished" are not confused.
    const { pool, underlying } = makePool({ eoseTimeoutMs: 10_000 })
    const outcome = pool.queryWithStatus([{ kinds: [1] }], undefined, 30_000, { graceMs: 300 })
    await settle()

    underlying.at(A).eose()
    for (const id of ['aa', 'bb', 'cc']) {
      await settle(200)
      underlying.at(B).emit(note(id))
    }
    await settle(400)

    expect((await outcome).events).toHaveLength(3)
    pool.close()
  })

  it('never settles early before ANY relay has answered', async () => {
    // Silence from everyone is not "the fast ones are done".
    const { pool } = makePool({ eoseTimeoutMs: 10_000 })
    let done = false
    void pool.queryWithStatus([{ kinds: [1] }], undefined, 30_000, { graceMs: 300 }).then(() => {
      done = true
    })
    await settle(2_000)
    expect(done).toBe(false)
    pool.close()
  })

  it('waits for every relay when a caller asks for completeness', async () => {
    // `graceMs: 0` is the opt-out, for a caller that would rather be slow than partial.
    const { pool, underlying } = makePool({ eoseTimeoutMs: 10_000 })
    let done = false
    const outcome = pool.queryWithStatus([{ kinds: [1] }], undefined, 30_000, { graceMs: 0 })
    void outcome.then(() => {
      done = true
    })
    await settle()

    underlying.at(A).eose()
    underlying.at(B).eose()
    await settle(3_000)
    expect(done).toBe(false)

    underlying.at(C).eose()
    await settle()
    expect((await outcome).answered).toBe(3)
    pool.close()
  })

  it('fires onEose even with no relays to talk to', async () => {
    const { pool } = makePool({ relays: [] })
    let eoses = 0
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {}, onEose: () => void (eoses += 1) })
    await settle()
    expect(eoses).toBe(1)
  })

  it('records per-relay latency from REQ to EOSE', async () => {
    let clock = 0
    const { pool, underlying } = makePool({ relays: readWrite(A), now: () => clock })
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    await settle()

    clock = 42
    underlying.at(A).eose()

    const status = pool.status().find(candidate => candidate.url === A)
    expect(status?.state).toBe('open')
    expect(status?.latencyMs).toBe(42)
  })

  it('resolves publish per relay and never rejects', async () => {
    const { pool, underlying } = makePool()
    underlying.seed(A).publishOk = ''
    underlying.seed(B).publishError = 'blocked: pubkey not allowed'
    underlying.unreachable.add(C)

    const results = await pool.publish(note('x'))

    expect(results).toEqual([
      { relay: A, ok: true, message: undefined },
      { relay: B, ok: false, message: 'blocked: pubkey not allowed' },
      { relay: C, ok: false, message: `failed to connect to ${C}` },
    ])
    expect(underlying.at(A).published).toHaveLength(1)
  })

  it('gives up on a relay that never answers a publish', async () => {
    const { pool, underlying } = makePool()
    underlying.seed(A).publishHangs = true

    const pending = pool.publish(note('x'), [A])
    await settle(2_000)

    expect(await pending).toEqual([{ relay: A, ok: false, message: `publish to ${A} timed out` }])
  })

  it('publishes only to write relays by default', async () => {
    const { pool } = makePool({
      relays: [
        { url: A, policy: { read: true, write: false } },
        { url: B, policy: { read: true, write: true } },
      ],
    })
    const results = await pool.publish(note('x'))
    expect(results.map(result => result.relay)).toEqual([B])
  })

  it('collects a query until EOSE, deduped, then closes the subscription', async () => {
    const { pool, underlying } = makePool()
    const pending = pool.query([{ kinds: [1] }])
    await settle()

    underlying.at(A).emit(note('aa'))
    underlying.at(B).emit(note('aa'))
    underlying.at(B).emit(note('bb'))
    for (const url of ALL) underlying.at(url).eose()

    expect((await pending).map(event => event.id)).toEqual(['aa', 'bb'])
    for (const url of ALL) expect(underlying.at(url).subs).toHaveLength(0)
  })

  /** The distinction the zaps page was missing. */
  describe('queryWithStatus', () => {
    it('counts a relay only when it sends a real EOSE', async () => {
      const { pool, underlying } = makePool()
      const pending = pool.queryWithStatus([{ kinds: [1] }])
      await settle()

      underlying.at(A).emit(note('aa'))
      for (const url of ALL) underlying.at(url).eose()

      const outcome = await pending
      expect(outcome.events.map(event => event.id)).toEqual(['aa'])
      expect(outcome.answered).toBe(3)
      expect(outcome.attempted).toBe(3)
    })

    it('reports nobody answered when every relay times out', async () => {
      const { pool } = makePool({ queryTimeoutMs: 5_000 })
      const pending = pool.queryWithStatus([{ kinds: [1] }])
      // Past the per-leg EOSE clock, which marks each leg done without the relay saying.
      await settle(6_000)

      const outcome = await pending
      expect(outcome.events).toEqual([])
      // The events look identical to "no matches".
      expect(outcome.answered).toBe(0)
      expect(outcome.attempted).toBe(3)
    })

    it('separates the relays that answered from the ones that did not', async () => {
      const { pool, underlying } = makePool({ queryTimeoutMs: 5_000 })
      const pending = pool.queryWithStatus([{ kinds: [1] }])
      await settle()

      underlying.at(A).eose()
      await settle(6_000)

      const outcome = await pending
      expect(outcome.answered).toBe(1)
      expect(outcome.attempted).toBe(3)
    })

    it('answers zero events with answered > 0 when the relays genuinely hold nothing', async () => {
      const { pool, underlying } = makePool()
      const pending = pool.queryWithStatus([{ kinds: [1] }])
      await settle()
      for (const url of ALL) underlying.at(url).eose()

      const outcome = await pending
      expect(outcome.events).toEqual([])
      // An empty answer IS an answer, and this one is safe to cache.
      expect(outcome.answered).toBe(3)
    })
  })

  it('reconnects after a drop, with jitter applied to the backoff', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A), random: () => 0 })
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    await settle()
    expect(underlying.at(A).subs).toHaveLength(1)

    underlying.at(A).drop()
    expect(underlying.at(A).subs).toHaveLength(0)

    // Equal jitter with random()===0 puts the first retry at half the base window.
    await settle(499)
    expect(underlying.at(A).subs).toHaveLength(0)
    await settle(2)
    expect(underlying.at(A).subs).toHaveLength(1)
  })

  it('spreads the retry across the window when the jitter rolls high', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A), random: () => 1 })
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    await settle()

    underlying.at(A).drop()
    await settle(999)
    expect(underlying.at(A).subs).toHaveLength(0)
    await settle(2)
    expect(underlying.at(A).subs).toHaveLength(1)
  })

  it('backs off further on each consecutive failure', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A), random: () => 0 })
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    await settle()
    expect(underlying.connectionsTo(A)).toBe(1)

    underlying.unreachable.add(A)
    underlying.at(A).drop()

    await settle(501)
    expect(underlying.connectionsTo(A)).toBe(2)
    await settle(1_001)
    expect(underlying.connectionsTo(A)).toBe(3)
    await settle(2_001)
    expect(underlying.connectionsTo(A)).toBe(4)
  })

  it('moves default subscriptions onto a relay set edited in Settings', async () => {
    const { pool, underlying } = makePool()
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    await settle()

    pool.setRelays(readWrite(A, 'wss://D.Example/'))
    await settle()

    expect(underlying.at(A).subs).toHaveLength(1)
    expect(underlying.at(B).subs).toHaveLength(0)
    expect(underlying.at('wss://d.example').subs).toHaveLength(1)
    expect(underlying.closedUrls).toEqual(expect.arrayContaining([B, C]))

    // A relay we let go must not resurrect itself through the reconnect path.
    await settle(5_000)
    expect(underlying.at(B).subs).toHaveLength(0)
  })

  it('leaves a subscription that named its own relays alone', async () => {
    const { pool, underlying } = makePool()
    pool.subscribe({ filters: [{ kinds: [1] }], relays: ['wss://A.example/'], onEvent: () => {} })
    await settle()

    pool.setRelays(readWrite(B))
    await settle()

    expect(underlying.at(A).subs).toHaveLength(1)
  })

  it('closes idempotently and tears down every subscription', async () => {
    const { pool, underlying } = makePool()
    const handle = pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    pool.subscribe({ filters: [{ kinds: [7] }], onEvent: () => {} })
    await settle()
    for (const url of ALL) expect(underlying.at(url).subs).toHaveLength(2)

    pool.close()
    pool.close()

    for (const url of ALL) expect(underlying.at(url).subs).toHaveLength(0)
    expect(underlying.closedUrls).toEqual(ALL)
    expect(pool.status().map(status => status.state)).toEqual(['closed', 'closed', 'closed'])

    expect(() => handle.close()).not.toThrow()
    expect(() => pool.subscribe({ filters: [{}], onEvent: () => {} }).close()).not.toThrow()
  })

  it('stops delivering after the handle is closed', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A) })
    const ids: string[] = []
    const handle = pool.subscribe({ filters: [{ kinds: [1] }], onEvent: event => void ids.push(event.id) })
    await settle()

    const relay = underlying.at(A)
    const sub = relay.subs[0]
    expect(sub).toBeDefined()

    handle.close()
    handle.close()
    expect(relay.subs).toHaveLength(0)

    sub?.params.onevent?.(note('aa'))
    expect(ids).toEqual([])
  })
})

/** NIP-45 COUNT. */
describe('count', () => {
  it('returns the count from a relay that implements it', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A) })
    underlying.seed(A).countAnswer = 3_987

    expect(await pool.count([{ kinds: [1] }])).toBe(3_987)
  })

  /** The largest answer wins, and it is a FLOOR. */
  it('KEEPS asking a relay that timed out, because a slow moment is not a missing feature', async () => {
    /* This test asserted the opposite until somebody's follower count fell from three. */
    const { pool, underlying } = makePool({ relays: readWrite(A, B) })
    underlying.seed(A).countAnswer = 6_139
    underlying.seed(B).countHangs = true

    expect(await pool.count([{ kinds: [3] }], undefined, 60)).toBe(6_139)
    expect(underlying.at(B).counted).toHaveLength(1)

    // Asked again, so the moment it starts answering its index counts again.
    expect(await pool.count([{ kinds: [3] }], undefined, 60)).toBe(6_139)
    expect(underlying.at(B).counted).toHaveLength(2)
    pool.close()
  })

  it('skips a recently silent relay ONLY for callers that asked to', async () => {
    /* The two kinds of counting, and why one flag decides between them. */
    const { pool, underlying } = makePool({ relays: readWrite(A, B) })
    underlying.seed(A).countAnswer = 6_139
    underlying.seed(B).countHangs = true

    // First call discovers the silence, at the cost of one timeout.
    expect(await pool.count([{ kinds: [1] }], undefined, 60, { skipUnresponsive: true })).toBe(6_139)
    expect(underlying.at(B).counted).toHaveLength(1)

    // An opt-in caller does not pay for it again.
    expect(await pool.count([{ kinds: [1] }], undefined, 60, { skipUnresponsive: true })).toBe(6_139)
    expect(underlying.at(B).counted).toHaveLength(1)

    // A caller that did NOT opt in still asks.
    expect(await pool.count([{ kinds: [3] }], undefined, 60)).toBe(6_139)
    expect(underlying.at(B).counted).toHaveLength(2)
    pool.close()
  })

  it('still writes off a relay that has no COUNT support at all', async () => {
    // The distinction the fix turns on: this is a fact about the relay, not about one.
    const { pool, underlying } = makePool({ relays: readWrite(A, B) })
    underlying.seed(A).countAnswer = 6_139
    // No `count` method at all, which is what most relays in the wild look.
    const b = underlying.seed(B) as unknown as { count?: unknown }
    b.count = undefined

    expect(await pool.count([{ kinds: [3] }], undefined, 60)).toBe(6_139)
    expect(await pool.count([{ kinds: [3] }], undefined, 60)).toBe(6_139)
    expect(underlying.at(B).counted).toHaveLength(0)
    pool.close()
  })

  it('keeps asking a relay that was merely unreachable', async () => {
    // Being briefly down says nothing about whether COUNT is implemented, and writing.
    const { pool, underlying } = makePool({ relays: readWrite(A, B) })
    underlying.seed(A).countAnswer = 10
    underlying.seed(B).countRejects = true

    expect(await pool.count([{ kinds: [3] }])).toBe(10)
    underlying.at(B).countRejects = false
    underlying.at(B).countAnswer = 99
    expect(await pool.count([{ kinds: [3] }])).toBe(99)
    pool.close()
  })

  it('takes the highest answer rather than the sum', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A, B) })
    underlying.seed(A).countAnswer = 6_139
    underlying.seed(B).countAnswer = 1_541

    expect(await pool.count([{ kinds: [3] }])).toBe(6_139)
  })

  it('reports nothing when no relay implements it', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A) })
    underlying.seed(A).countRejects = true

    // Not zero.
    expect(await pool.count([{ kinds: [1] }])).toBeUndefined()
  })

  it('still answers when only one of several relays can', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A, B) })
    underlying.seed(A).countRejects = true
    underlying.seed(B).countAnswer = 42

    expect(await pool.count([{ kinds: [1] }])).toBe(42)
  })

  it('is not held up by a relay that never replies', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A, B) })
    underlying.seed(A).countHangs = true
    underlying.seed(B).countAnswer = 7

    expect(await pool.count([{ kinds: [1] }], undefined, 20)).toBe(7)
  })

  it('asks only the relays it was pointed at', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A, B) })
    underlying.seed(A).countAnswer = 1
    underlying.seed(B).countAnswer = 2

    await pool.count([{ kinds: [1] }], [B as RelayUrl])
    expect(underlying.seed(A).counted).toHaveLength(0)
    expect(underlying.seed(B).counted).toHaveLength(1)
  })

  it('rejects a nonsense answer rather than passing it on', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(A) })
    underlying.seed(A).countAnswer = -1

    expect(await pool.count([{ kinds: [1] }])).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------.

/** Relays cap concurrent REQs per connection. */
describe('per-relay subscription ceiling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('never opens more than the ceiling on one relay', async () => {
    const { pool, underlying } = makePool({ maxSubsPerRelay: 3 })
    for (let i = 0; i < 10; i += 1) {
      pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    }
    await settle()
    expect(underlying.at(ALL[0]!).subs.length).toBe(3)
    pool.close()
  })

  it('starts a queued REQ as soon as one ahead of it closes', async () => {
    const { pool, underlying } = makePool({ maxSubsPerRelay: 2 })
    const handles = [0, 1, 2].map(() =>
      pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} }),
    )
    await settle()
    const relay = underlying.at(ALL[0]!)
    expect(relay.subs.length).toBe(2)

    handles[0]!.close()
    await settle()
    // The third took the freed slot rather than waiting for a timeout to expire.
    expect(relay.subs.length).toBe(2)
    expect(relay.filters.length).toBe(3)
    pool.close()
  })

  /** The whole point of the flag: a live stream must not wait behind speculative lookups. */
  it('admits a live subscription even when the ceiling is full', async () => {
    const { pool, underlying } = makePool({ maxSubsPerRelay: 2 })
    for (let i = 0; i < 5; i += 1) {
      pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    }
    await settle()
    const relay = underlying.at(ALL[0]!)
    expect(relay.subs.length).toBe(2)

    const events: NostrEvent[] = []
    pool.subscribe({ filters: [{ kinds: [7] }], onEvent: event => events.push(event), live: true })
    await settle()
    expect(relay.subs.length).toBe(3)

    relay.emit(note('a'.repeat(64)))
    expect(events).toHaveLength(1)
    pool.close()
  })

  /** A queued leg has not been asked anything yet, so it cannot be late. */
  it('does not start a queued leg’s EOSE clock until it is sent', async () => {
    const { pool, underlying } = makePool({ maxSubsPerRelay: 1, eoseTimeoutMs: 1_000 })
    const first = pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    let eosed = false
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {}, onEose: () => (eosed = true) })
    await settle()

    // Well past the EOSE timeout, still queued, still not written off.
    await settle(3_000)
    expect(eosed).toBe(false)

    first.close()
    await settle()
    expect(underlying.at(ALL[0]!).subs.length).toBe(1)
    // Now it is sent, and its own clock decides its fate.
    await settle(1_100)
    expect(eosed).toBe(true)
    pool.close()
  })

  /** A relay dropping a REQ must give the slot back, or the ceiling leaks away to nothing. */
  it('reclaims the slot when a relay drops the subscription', async () => {
    const { pool, underlying } = makePool({ maxSubsPerRelay: 1 })
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    pool.subscribe({ filters: [{ kinds: [2] }], onEvent: () => {} })
    await settle()
    const relay = underlying.at(ALL[0]!)
    expect(relay.subs.length).toBe(1)

    relay.drop()
    await settle()
    expect(relay.subs.length).toBe(1)
    pool.close()
  })
})

/** The ceiling bounds SPECULATIVE work, not the streams a reader is waiting. */
describe('live subscriptions and the ceiling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not spend the budget on live subscriptions', async () => {
    const { pool, underlying } = makePool({ maxSubsPerRelay: 3 })
    // Three streams that stay open for the session.
    for (let i = 0; i < 3; i += 1) {
      pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {}, live: true })
    }
    await settle()
    // The full budget is still available to one-shot work.
    for (let i = 0; i < 3; i += 1) {
      pool.subscribe({ filters: [{ kinds: [7] }], onEvent: () => {} })
    }
    await settle()
    expect(underlying.at(ALL[0]!).subs.length).toBe(6)
    pool.close()
  })

  it('still queues one-shot work past the ceiling while streams are open', async () => {
    const { pool, underlying } = makePool({ maxSubsPerRelay: 2 })
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {}, live: true })
    for (let i = 0; i < 5; i += 1) {
      pool.subscribe({ filters: [{ kinds: [7] }], onEvent: () => {} })
    }
    await settle()
    // One stream plus exactly the budget.
    expect(underlying.at(ALL[0]!).subs.length).toBe(3)
    pool.close()
  })
})

/** A DEAD RELAY THAT ARRIVED AS A HINT IS NOT DIALLED FOREVER. */
describe('backoff for hinted relays', () => {
  const DEAD = 'wss://dead.example'

  // `settle` drives fake time.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops dialling a hinted relay while its window is open, and resumes after', async () => {
    const { pool, underlying } = makePool({ relays: readWrite(...ALL) })
    underlying.unreachable.add(DEAD)

    pool.subscribe({ filters: [{ kinds: [1] }], relays: [DEAD], onEvent: () => {} })
    await settle(50)
    const first = underlying.ensureCalls.filter(url => url.includes('dead.example')).length
    expect(first).toBeGreaterThan(0)

    // A second subscription naming the same dead relay, immediately: no new dial.
    pool.subscribe({ filters: [{ kinds: [1] }], relays: [DEAD], onEvent: () => {} })
    await settle(50)
    expect(underlying.ensureCalls.filter(url => url.includes('dead.example')).length).toBe(first)

    // Well past the backoff window it is tried again.
    await settle(5 * 60_000)
    pool.subscribe({ filters: [{ kinds: [1] }], relays: [DEAD], onEvent: () => {} })
    await settle(50)
    expect(underlying.ensureCalls.filter(url => url.includes('dead.example')).length).toBeGreaterThan(first)
    pool.close()
  })

  it('never skips a relay the reader configured', async () => {
    const mine = A
    const { pool, underlying } = makePool()
    underlying.unreachable.add(mine)

    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} })
    await settle(50)
    const first = underlying.ensureCalls.filter(url => url.includes('a.example')).length

    pool.subscribe({ filters: [{ kinds: [2] }], onEvent: () => {} })
    await settle(50)
    // Their own relay is dialled again straight away, however it behaved a moment ago.
    expect(underlying.ensureCalls.filter(url => url.includes('a.example')).length).toBeGreaterThan(first)
    pool.close()
  })
})

describe('publishFirstAccept', () => {
  /** The whole point is answering at the speed of the FASTEST acceptance, so the tests. */
  it('resolves true on the first OK without waiting for slower relays', async () => {
    const pool = createPool({
      relays: [
        { url: 'wss://fast.example/' as RelayUrl, policy: { read: true, write: true } },
        { url: 'wss://hangs.example/' as RelayUrl, policy: { read: true, write: true } },
      ],
    })
    const calls: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(pool as any).publishTo = (_event: NostrEvent, url: string) => {
      calls.push(url)
      if (url.includes('fast')) return Promise.resolve({ url, ok: true })
      return new Promise(() => {})   // never settles, a relay that just sits there
    }
    const accepted = await pool.publishFirstAccept({ id: 'x', kind: 1 } as unknown as NostrEvent)
    expect(accepted).toBe(true)
    // The slow relay was still ASKED.
    expect(calls.sort()).toEqual(['wss://fast.example', 'wss://hangs.example'])
  })

  it('resolves false only once every relay has answered without an acceptance', async () => {
    const pool = createPool({
      relays: [
        { url: 'wss://a.example/' as RelayUrl, policy: { read: true, write: true } },
        { url: 'wss://b.example/' as RelayUrl, policy: { read: true, write: true } },
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(pool as any).publishTo = (_e: NostrEvent, url: string) =>
      Promise.resolve({ url, ok: false, reason: 'blocked' })
    expect(await pool.publishFirstAccept({ id: 'x', kind: 1 } as unknown as NostrEvent)).toBe(false)
  })

  it('a late acceptance still wins after early refusals', async () => {
    const pool = createPool({
      relays: [
        { url: 'wss://no.example/' as RelayUrl, policy: { read: true, write: true } },
        { url: 'wss://slowyes.example/' as RelayUrl, policy: { read: true, write: true } },
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(pool as any).publishTo = (_e: NostrEvent, url: string) =>
      url.includes('slowyes')
        ? new Promise(resolve => setTimeout(() => resolve({ url, ok: true }), 30))
        : Promise.resolve({ url, ok: false, reason: 'nope' })
    expect(await pool.publishFirstAccept({ id: 'x', kind: 1 } as unknown as NostrEvent)).toBe(true)
  })

  it('never publishes to a read-only relay, same as publish', async () => {
    const pool = createPool({
      relays: [
        { url: 'wss://readonly.example/' as RelayUrl, policy: { read: true, write: false } },
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(pool as any).publishTo = (_e: NostrEvent, url: string) => {
      calls.push(url)
      return Promise.resolve({ url, ok: true })
    }
    expect(await pool.publishFirstAccept({ id: 'x', kind: 1 } as unknown as NostrEvent)).toBe(false)
    expect(calls).toEqual([])
  })
})
