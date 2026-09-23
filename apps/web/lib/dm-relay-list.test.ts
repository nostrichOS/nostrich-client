import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent, QueryOutcome } from '@nostrich/nostr'

/** WHEN THIS APP MAY WRITE A KIND-10050, AND WHAT IT PUTS IN ONE. */

const queryWithStatus = vi.fn<(...args: unknown[]) => Promise<QueryOutcome>>()
const publish = vi.fn<(...args: unknown[]) => Promise<{ relay: string; ok: boolean }[]>>()
const subscribe = vi.fn(() => ({ close: () => undefined }))

// `query` delegates to `queryWithStatus` here exactly as the real pool does.
vi.mock('./pool', () => ({
  getPool: () => ({
    queryWithStatus,
    publish,
    subscribe,
    query: async (...args: unknown[]) => (await queryWithStatus(...args)).events,
  }),
}))

const { ensureDmRelayList, sendChatMessage } = await import('./chat')
const { DEFAULT_DM_RELAYS, PrivateKeySigner, generateKeyPair } = await import('@nostrich/nostr')

const ME = 'a'.repeat(64)

const signer = {
  kind: 'privatekey' as const,
  getPublicKey: async () => ME,
  signEvent: async (template: { kind: number; tags: string[][]; content: string; created_at: number }) => ({
    ...template,
    id: 'e'.repeat(64),
    pubkey: ME,
    sig: '0'.repeat(128),
  }),
  nip44Encrypt: async () => 'x',
  nip44Decrypt: async () => 'x',
}

function list(relays: string[], createdAt = 1_000): NostrEvent {
  return {
    id: 'l'.repeat(64),
    pubkey: ME,
    created_at: createdAt,
    kind: 10050,
    tags: relays.map(url => ['relay', url]),
    content: '',
    sig: '0'.repeat(128),
  }
}

beforeEach(() => {
  queryWithStatus.mockReset()
  publish.mockReset()
  publish.mockResolvedValue([{ relay: 'wss://nos.lol', ok: true }])
})

describe('ensureDmRelayList', () => {
  it('publishes nothing when no relay answered, however empty the result looks', async () => {
    // The whole incident in one line.
    queryWithStatus.mockResolvedValue({ events: [], answered: 0, attempted: 6 })
    await ensureDmRelayList(signer as never, ME)
    expect(publish).not.toHaveBeenCalled()
  })

  it('leaves an existing list alone, whatever relays it names', async () => {
    const chosen = ['wss://relay.example.one', 'wss://relay.example.two']
    queryWithStatus.mockResolvedValue({ events: [list(chosen)], answered: 4, attempted: 6 })
    await ensureDmRelayList(signer as never, ME)
    expect(publish).not.toHaveBeenCalled()
  })

  it('creates one when the relays answered and genuinely held none', async () => {
    queryWithStatus.mockResolvedValue({ events: [], answered: 4, attempted: 6 })
    await ensureDmRelayList(signer as never, ME)
    expect(publish).toHaveBeenCalledTimes(1)
    const event = publish.mock.calls[0]?.[0] as NostrEvent
    expect(event.kind).toBe(10050)
  })

  it('treats a list with no usable relay as none, since it can deliver nothing', async () => {
    queryWithStatus.mockResolvedValue({ events: [list([])], answered: 4, attempted: 6 })
    await ensureDmRelayList(signer as never, ME)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('keeps the newest list when relays disagree about which is current', async () => {
    queryWithStatus.mockResolvedValue({
      events: [list(['wss://old.example'], 1_000), list(['wss://new.example'], 2_000)],
      answered: 4,
      attempted: 6,
    })
    await ensureDmRelayList(signer as never, ME)
    expect(publish).not.toHaveBeenCalled()
  })
})

/** A DM inbox relay has one job an ordinary read relay does not: accept a write. */
describe('the relays a created list names', () => {
  it('names only relays from the vetted list', async () => {
    queryWithStatus.mockResolvedValue({ events: [], answered: 4, attempted: 6 })
    await ensureDmRelayList(signer as never, ME)
    const event = publish.mock.calls[0]?.[0] as NostrEvent
    const named = event.tags.filter(tag => tag[0] === 'relay').map(tag => tag[1])
    expect(named.length).toBeGreaterThan(0)
    for (const url of named) expect(DEFAULT_DM_RELAYS).toContain(url)
  })

  it('has more than one, so losing one does not lose the inbox', async () => {
    expect(DEFAULT_DM_RELAYS.length).toBeGreaterThan(1)
  })

  it('is never empty, an empty kind-10050 reads as "cannot receive messages"', () => {
    expect(DEFAULT_DM_RELAYS.length).toBeGreaterThan(0)
  })
})

/** "SENT" HAS TO MEAN SENT, FOR EACH PERSON SEPARATELY. */
describe('sendChatMessage', () => {
  const REFUSING = 'wss://refuses.example'
  const ACCEPTING = 'wss://accepts.example'

  function peer(relays: string[]) {
    const { publicKey: pubkey } = generateKeyPair()
    return {
      pubkey,
      event: {
        id: 'p'.repeat(64),
        pubkey,
        created_at: 2_000,
        kind: 10050,
        tags: relays.map(url => ['relay', url]),
        content: '',
        sig: '0'.repeat(128),
      } as NostrEvent,
    }
  }

  // A relay set is "accepting" only if it contains the accepting relay.
  function publishByRelay(_wrap: unknown, relays?: string[]) {
    const list = relays ?? []
    return Promise.resolve(list.map(relay => ({ relay, ok: relay === ACCEPTING })))
  }

  it('names the recipient whose relays all refused, and does not call it sent to them', async () => {
    const good = peer([ACCEPTING])
    const bad = peer([REFUSING])
    queryWithStatus.mockResolvedValue({ events: [good.event, bad.event], answered: 4, attempted: 6 })
    publish.mockImplementation(publishByRelay as never)

    const signer = PrivateKeySigner.fromSecretKey(generateKeyPair().secretKey)
    const result = await sendChatMessage(signer as never, [good.pubkey, bad.pubkey], 'hello')

    expect(result.unreachable).toEqual([bad.pubkey])
    expect(result.undeliverable).toEqual([])
    // Something did land, so the message exists and the composer may clear.
    expect(result.ok).toBe(true)
  })

  it('says nothing is unreachable when every recipient took it', async () => {
    const a = peer([ACCEPTING])
    const b = peer([ACCEPTING])
    queryWithStatus.mockResolvedValue({ events: [a.event, b.event], answered: 4, attempted: 6 })
    publish.mockImplementation(publishByRelay as never)

    const signer = PrivateKeySigner.fromSecretKey(generateKeyPair().secretKey)
    const result = await sendChatMessage(signer as never, [a.pubkey, b.pubkey], 'hello')

    expect(result.unreachable).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('reports failure when the only recipient refused it', async () => {
    const only = peer([REFUSING])
    queryWithStatus.mockResolvedValue({ events: [only.event], answered: 4, attempted: 6 })
    publish.mockImplementation(publishByRelay as never)

    const signer = PrivateKeySigner.fromSecretKey(generateKeyPair().secretKey)
    const result = await sendChatMessage(signer as never, [only.pubkey], 'hello')

    expect(result.unreachable).toEqual([only.pubkey])
    expect(result.ok).toBe(false)
  })

  it('still separates "no list at all" from "list, but nothing accepted"', async () => {
    const listed = peer([REFUSING])
    const noList = peer([])
    queryWithStatus.mockResolvedValue({ events: [listed.event], answered: 4, attempted: 6 })
    publish.mockImplementation(publishByRelay as never)

    const signer = PrivateKeySigner.fromSecretKey(generateKeyPair().secretKey)
    const result = await sendChatMessage(signer as never, [listed.pubkey, noList.pubkey], 'hello')

    expect(result.undeliverable).toEqual([noList.pubkey])
    expect(result.unreachable).toEqual([listed.pubkey])
  })
})
