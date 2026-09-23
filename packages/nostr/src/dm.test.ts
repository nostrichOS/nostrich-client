import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey } from 'nostr-tools/pure'
import {
  decrypt as nip44Decrypt,
  encrypt as nip44Encrypt,
  getConversationKey,
} from 'nostr-tools/nip44'
import { GiftWrap, Seal } from 'nostr-tools/kinds'

import type { DirectMessage } from './types'

import {
  MAX_WRAP_JITTER_SECONDS,
  buildDirectMessage,
  buildDmRelayList,
  conversationKeyOf,
  dmRelayListFilter,
  giftWrapFilter,
  groupConversations,
  isFileMessage,
  parseDmRelayList,
  routeWraps,
  unwrapDirectMessage,
} from './dm'
import type { EventTemplate, Hex, NostrEvent, Signer } from './types'

/** Stands in for PrivateKeySigner. */
class TestSigner implements Signer {
  readonly kind = 'privatekey' as const

  constructor(private readonly secret: Uint8Array) {}

  async getPublicKey(): Promise<Hex> {
    return getPublicKey(this.secret)
  }

  async signEvent(template: EventTemplate): Promise<NostrEvent> {
    // finalizeEvent writes pubkey/id/sig onto the object it is handed.
    return finalizeEvent({ ...template, tags: template.tags.map((tag) => [...tag]) }, this.secret)
  }

  async nip44Encrypt(peer: Hex, plaintext: string): Promise<string> {
    return nip44Encrypt(plaintext, getConversationKey(this.secret, peer))
  }

  async nip44Decrypt(peer: Hex, ciphertext: string): Promise<string> {
    return nip44Decrypt(ciphertext, getConversationKey(this.secret, peer))
  }
}

interface Identity {
  secret: Uint8Array
  pubkey: Hex
  signer: TestSigner
}

function identity(): Identity {
  const secret = generateSecretKey()
  return { secret, pubkey: getPublicKey(secret), signer: new TestSigner(secret) }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function wrapFor(wraps: Array<{ recipient: Hex; wrap: NostrEvent }>, recipient: Hex): NostrEvent {
  const found = wraps.find((delivery) => delivery.recipient === recipient)
  if (found === undefined) throw new Error(`no wrap addressed to ${recipient}`)
  return found.wrap
}

/** Peel one layer by hand, so the tests can assert on what is actually on the wire. */
function openLayer(
  layer: { pubkey: string; content: string },
  secret: Uint8Array,
): Record<string, unknown> {
  return JSON.parse(nip44Decrypt(layer.content, getConversationKey(secret, layer.pubkey)))
}

function rumor(pubkey: Hex, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const base = {
    pubkey,
    created_at: nowSeconds(),
    kind: 14,
    tags: [] as string[][],
    content: 'forged',
    ...overrides,
  }
  return { ...base, id: getEventHash(base as never) }
}

function sealFor(payload: unknown, sealSecret: Uint8Array, recipient: Hex): NostrEvent {
  return finalizeEvent(
    {
      kind: Seal,
      content: nip44Encrypt(JSON.stringify(payload), getConversationKey(sealSecret, recipient)),
      created_at: nowSeconds() - 600,
      tags: [],
    },
    sealSecret,
  )
}

function wrapFrom(seal: NostrEvent, recipient: Hex): NostrEvent {
  const throwaway = generateSecretKey()
  return finalizeEvent(
    {
      kind: GiftWrap,
      content: nip44Encrypt(JSON.stringify(seal), getConversationKey(throwaway, recipient)),
      created_at: nowSeconds() - 600,
      tags: [['p', recipient]],
    },
    throwaway,
  )
}

describe('buildDirectMessage / unwrapDirectMessage', () => {
  it('round-trips a message to the recipient', async () => {
    const alice = identity()
    const bob = identity()

    const built = await buildDirectMessage(alice.signer, [bob.pubkey], 'meet me at the usual place')
    expect(built.wraps).toHaveLength(2)

    const wrap = wrapFor(built.wraps, bob.pubkey)
    const received = await unwrapDirectMessage(bob.signer, wrap)

    expect(received).not.toBeNull()
    expect(received?.content).toBe('meet me at the usual place')
    expect(received?.senderPubkey).toBe(alice.pubkey)
    expect(received?.participants).toEqual([alice.pubkey, bob.pubkey].sort())
    expect(received?.id).toBe(built.message.id)
    expect(received?.wrapId).toBe(wrap.id)
  })

  it('lets the sender read their own copy on a new device', async () => {
    const alice = identity()
    const bob = identity()

    const built = await buildDirectMessage(alice.signer, [bob.pubkey], 'sent from my phone')
    const ownCopy = await unwrapDirectMessage(alice.signer, wrapFor(built.wraps, alice.pubkey))

    expect(ownCopy?.content).toBe('sent from my phone')
    expect(ownCopy?.senderPubkey).toBe(alice.pubkey)
    // Same rumor sealed twice, so both devices agree this is one message.
    expect(ownCopy?.id).toBe(built.message.id)
  })

  it('signs each wrap with a different throwaway key', async () => {
    const alice = identity()
    const bob = identity()

    const built = await buildDirectMessage(alice.signer, [bob.pubkey], 'hi')
    const authors = built.wraps.map((delivery) => delivery.wrap.pubkey)

    for (const [index, delivery] of built.wraps.entries()) {
      expect(delivery.wrap.kind).toBe(1059)
      expect(delivery.wrap.pubkey).not.toBe(alice.pubkey)
      expect(delivery.wrap.pubkey).not.toBe(bob.pubkey)
      expect(delivery.wrap.tags).toEqual([['p', delivery.recipient]])
      expect(authors.indexOf(delivery.wrap.pubkey)).toBe(index)
    }
  })

  it('backdates the wrap and the seal, never the rumor', async () => {
    const alice = identity()
    const bob = identity()

    const built = await buildDirectMessage(alice.signer, [bob.pubkey], 'timestamps')
    const wrap = wrapFor(built.wraps, bob.pubkey)

    expect(wrap.created_at).toBeLessThan(built.message.createdAt)
    expect(wrap.created_at).toBeGreaterThanOrEqual(built.message.createdAt - MAX_WRAP_JITTER_SECONDS)

    const seal = openLayer(wrap, bob.secret)
    expect(seal.kind).toBe(13)
    expect(seal.created_at as number).toBeLessThan(built.message.createdAt)
  })

  it('leaves the rumor unsigned and authored by the real sender', async () => {
    const alice = identity()
    const bob = identity()

    const built = await buildDirectMessage(alice.signer, [bob.pubkey], 'unsigned by design')
    const seal = openLayer(wrapFor(built.wraps, bob.pubkey), bob.secret)
    expect(seal.pubkey).toBe(alice.pubkey)

    const inner = openLayer(seal as { pubkey: string; content: string }, bob.secret)
    expect(inner.kind).toBe(14)
    expect(inner.pubkey).toBe(alice.pubkey)
    expect(inner.created_at).toBe(built.message.createdAt)
    expect('sig' in inner).toBe(false)
  })

  it('discards a rumor whose author does not match the seal', async () => {
    const alice = identity()
    const bob = identity()
    const mallory = identity()

    // Mallory seals under her own key a rumor that claims Alice wrote.
    const forged = wrapFrom(sealFor(rumor(alice.pubkey), mallory.secret, bob.pubkey), bob.pubkey)

    expect(await unwrapDirectMessage(bob.signer, forged)).toBeNull()
  })

  it('discards a rumor that arrives signed', async () => {
    const alice = identity()
    const bob = identity()

    const signedRumor = finalizeEvent(
      { kind: 14, created_at: nowSeconds(), tags: [['p', bob.pubkey]], content: 'receipt' },
      alice.secret,
    )
    const wrap = wrapFrom(sealFor(signedRumor, alice.secret, bob.pubkey), bob.pubkey)

    expect(await unwrapDirectMessage(bob.signer, wrap)).toBeNull()
  })

  it('discards a rumor whose declared id does not match its content', async () => {
    const alice = identity()
    const bob = identity()

    const tampered = { ...rumor(alice.pubkey), id: 'f'.repeat(64) }
    const wrap = wrapFrom(sealFor(tampered, alice.secret, bob.pubkey), bob.pubkey)

    expect(await unwrapDirectMessage(bob.signer, wrap)).toBeNull()
  })

  it('discards wraps addressed to someone else and non-wrap events', async () => {
    const alice = identity()
    const bob = identity()
    const mallory = identity()

    const built = await buildDirectMessage(alice.signer, [bob.pubkey], 'private')
    const wrap = wrapFor(built.wraps, bob.pubkey)

    expect(await unwrapDirectMessage(mallory.signer, wrap)).toBeNull()
    expect(await unwrapDirectMessage(bob.signer, { ...wrap, kind: 1 })).toBeNull()
  })

  it('refuses to surface a wrapped event that is not a private message', async () => {
    const alice = identity()
    const bob = identity()

    const note = rumor(alice.pubkey, { kind: 1, content: 'a public note in a wrap' })
    const wrap = wrapFrom(sealFor(note, alice.secret, bob.pubkey), bob.pubkey)

    expect(await unwrapDirectMessage(bob.signer, wrap)).toBeNull()
  })

  it('carries a reply reference', async () => {
    const alice = identity()
    const bob = identity()
    const parentId = 'a'.repeat(64)

    const built = await buildDirectMessage(alice.signer, [bob.pubkey], 'yes', parentId)
    const received = await unwrapDirectMessage(bob.signer, wrapFor(built.wraps, bob.pubkey))

    expect(built.message.replyToId).toBe(parentId)
    expect(received?.replyToId).toBe(parentId)
  })

  it('round-trips a kind-15 file message', async () => {
    const alice = identity()
    const bob = identity()
    const file = {
      mimeType: 'image/jpeg',
      algorithm: 'aes-gcm',
      key: 'b'.repeat(64),
      nonce: 'c'.repeat(32),
      sha256: 'd'.repeat(64),
      size: 20480,
      dim: '1200x900',
    }

    const built = await buildDirectMessage(
      alice.signer,
      [bob.pubkey],
      'https://blossom.example/deadbeef.jpg',
      undefined,
      { file },
    )
    const received = await unwrapDirectMessage(bob.signer, wrapFor(built.wraps, bob.pubkey))

    expect(received).not.toBeNull()
    if (received === null || !isFileMessage(received)) throw new Error('expected a file message')
    expect(received.content).toBe('https://blossom.example/deadbeef.jpg')
    expect(received.file).toEqual(file)

    const seal = openLayer(wrapFor(built.wraps, bob.pubkey), bob.secret)
    expect(openLayer(seal as { pubkey: string; content: string }, bob.secret).kind).toBe(15)
  })

  it('drops a kind-15 that lost its decryption tags', async () => {
    const alice = identity()
    const bob = identity()

    const stripped = rumor(alice.pubkey, { kind: 15, content: 'https://blossom.example/x.jpg' })
    const wrap = wrapFrom(sealFor(stripped, alice.secret, bob.pubkey), bob.pubkey)

    expect(await unwrapDirectMessage(bob.signer, wrap)).toBeNull()
  })

  it('keeps a group on one conversation across every recipient', async () => {
    const alice = identity()
    const bob = identity()
    const carol = identity()
    const expected = [alice.pubkey, bob.pubkey, carol.pubkey].sort()

    const built = await buildDirectMessage(alice.signer, [bob.pubkey, carol.pubkey], 'all three')
    expect(built.wraps).toHaveLength(3)

    const asBob = await unwrapDirectMessage(bob.signer, wrapFor(built.wraps, bob.pubkey))
    const asCarol = await unwrapDirectMessage(carol.signer, wrapFor(built.wraps, carol.pubkey))
    const asAlice = await unwrapDirectMessage(alice.signer, wrapFor(built.wraps, alice.pubkey))

    for (const message of [asBob, asCarol, asAlice]) {
      expect(message?.participants).toEqual(expected)
      expect(message?.id).toBe(built.message.id)
      expect(conversationKeyOf(message?.participants ?? [])).toBe(expected.join(':'))
    }
  })

  it('supports a note to self', async () => {
    const alice = identity()

    const built = await buildDirectMessage(alice.signer, [], 'remember the milk')
    expect(built.wraps).toHaveLength(1)

    const received = await unwrapDirectMessage(alice.signer, wrapFor(built.wraps, alice.pubkey))
    expect(received?.participants).toEqual([alice.pubkey])
    expect(received?.content).toBe('remember the milk')
  })

  it('rejects participants that are not lowercase hex', async () => {
    const alice = identity()

    await expect(
      buildDirectMessage(alice.signer, ['npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'], 'hi'),
    ).rejects.toThrow(/hex/)
  })
})

describe('conversations', () => {
  it('keys a conversation by its participant set regardless of order', () => {
    const one = 'a'.repeat(64)
    const two = 'b'.repeat(64)

    expect(conversationKeyOf([two, one])).toBe(`${one}:${two}`)
    expect(conversationKeyOf([one, two, one])).toBe(`${one}:${two}`)
  })

  it('counts only unseen messages from other people as unread', () => {
    const self = 'a'.repeat(64)
    const peer = 'b'.repeat(64)
    const key = conversationKeyOf([self, peer])
    const message = (id: string, sender: string, createdAt: number) => ({
      id,
      senderPubkey: sender,
      participants: [peer, self],
      content: id,
      createdAt,
      wrapId: id,
    })

    const conversations = groupConversations(
      [message('1'.repeat(64), peer, 100), message('2'.repeat(64), self, 200), message('3'.repeat(64), peer, 300)],
      { self, lastReadAt: { [key]: 150 } },
    )

    expect(conversations).toHaveLength(1)
    expect(conversations[0]?.key).toBe(key)
    expect(conversations[0]?.participants).toEqual([self, peer].sort())
    expect(conversations[0]?.lastMessageAt).toBe(300)
    expect(conversations[0]?.unreadCount).toBe(1)
  })
})

describe('DM relay lists', () => {
  it('round-trips a kind-10050 list', async () => {
    const alice = identity()

    const event = await buildDmRelayList(alice.signer, ['wss://inbox.example/', 'wss://inbox.example', 'wss://dm.example'])
    expect(event.kind).toBe(10050)

    const parsed = parseDmRelayList(event)
    expect(parsed?.pubkey).toBe(alice.pubkey)
    expect(parsed?.relays).toEqual(['wss://inbox.example', 'wss://dm.example'])
  })

  it('refuses to publish an empty list and ignores junk entries', async () => {
    const alice = identity()

    await expect(buildDmRelayList(alice.signer, [])).rejects.toThrow(/at least one relay/)
    await expect(buildDmRelayList(alice.signer, ['inbox.example'])).rejects.toThrow(/relay URL/)

    const junk = await alice.signer.signEvent({
      kind: 10050,
      created_at: nowSeconds(),
      tags: [['relay', 'not-a-url'], ['p', 'x'], ['relay']],
      content: '',
    })
    expect(parseDmRelayList(junk)?.relays).toEqual([])
    expect(parseDmRelayList({ ...junk, kind: 10002 })).toBeNull()
  })

  it('routes each wrap to its own recipient inbox and reports who cannot be reached', async () => {
    const alice = identity()
    const bob = identity()
    const carol = identity()

    const built = await buildDirectMessage(alice.signer, [bob.pubkey, carol.pubkey], 'routing')
    const lists = new Map([
      [alice.pubkey, { pubkey: alice.pubkey, relays: ['wss://alice.example'], updatedAt: 1 }],
      [bob.pubkey, { pubkey: bob.pubkey, relays: ['wss://bob.example'], updatedAt: 1 }],
    ])

    const { deliveries, undeliverable } = routeWraps(built.wraps, lists)

    expect(undeliverable).toEqual([carol.pubkey])
    expect(deliveries).toHaveLength(2)
    for (const delivery of deliveries) {
      expect(delivery.relays).toEqual(lists.get(delivery.recipient)?.relays)
      expect(delivery.wrap.tags[0]?.[1]).toBe(delivery.recipient)
    }
  })

  it('widens the gift wrap sync window by the full jitter', () => {
    const pubkey = 'a'.repeat(64)
    const lastSync = 1_800_000_000

    expect(giftWrapFilter(pubkey)).toEqual({ kinds: [1059], '#p': [pubkey] })
    expect(giftWrapFilter(pubkey, lastSync).since).toBe(lastSync - MAX_WRAP_JITTER_SECONDS)
    expect(giftWrapFilter(pubkey, 10).since).toBe(0)
    expect(dmRelayListFilter([pubkey])).toEqual({ kinds: [10050], authors: [pubkey] })
    expect(() => giftWrapFilter('npub1xyz')).toThrow(/hex/)
  })
})

/** A SIGNER THAT DOES NOT ENCRYPT MUST NOT BE ABLE TO SEND. */
describe('a signer that does not actually encrypt', () => {
  class EchoSigner extends TestSigner {
    override async nip44Encrypt(_peer: Hex, plaintext: string): Promise<string> {
      return plaintext
    }
  }

  class EmptySigner extends TestSigner {
    override async nip44Encrypt(): Promise<string> {
      return ''
    }
  }

  it('refuses to build a message when the seal would be readable', async () => {
    const bob = identity()
    const secret = generateSecretKey()
    const echo = new EchoSigner(secret)
    await expect(buildDirectMessage(echo, [bob.pubkey], 'meet me at the usual place')).rejects.toThrow(
      /did not encrypt/,
    )
  })

  it('refuses an empty seal, which would publish a message nobody can read', async () => {
    const bob = identity()
    const empty = new EmptySigner(generateSecretKey())
    await expect(buildDirectMessage(empty, [bob.pubkey], 'hi')).rejects.toThrow(/did not encrypt/)
  })

  it('still builds normally for a signer that encrypts', async () => {
    const alice = identity()
    const bob = identity()
    const built = await buildDirectMessage(alice.signer, [bob.pubkey], 'meet me at the usual place')
    for (const delivery of built.wraps) {
      // Nothing readable anywhere in what reaches a relay.
      expect(JSON.stringify(delivery.wrap)).not.toContain('meet me at the usual place')
    }
    expect(await unwrapDirectMessage(bob.signer, wrapFor(built.wraps, bob.pubkey))).not.toBeNull()
  })
})

/** THE FLOOR UNDER UNREAD. */
describe('groupConversations floorAt', () => {
  const ME = 'a'.repeat(64)
  const THEM = 'b'.repeat(64)
  const key = conversationKeyOf([ME, THEM])

  const msg = (id: string, at: number, from: string): DirectMessage =>
    ({ id, createdAt: at, senderPubkey: from, participants: [ME, THEM] }) as DirectMessage

  const messages = [msg('old', 1000, THEM), msg('new', 3000, THEM)]

  it('counts everything unread with no marker and no floor', () => {
    expect(groupConversations(messages, { self: ME })[0]?.unreadCount).toBe(2)
  })

  it('ignores anything at or below the floor', () => {
    expect(groupConversations(messages, { self: ME, floorAt: 2000 })[0]?.unreadCount).toBe(1)
  })

  it('lets a real marker move past the floor, never behind it', () => {
    // The published marker is ahead: it wins, and the floor changes nothing.
    expect(
      groupConversations(messages, { self: ME, floorAt: 500, lastReadAt: { [key]: 3000 } })[0]?.unreadCount,
    ).toBe(0)
    // The published marker is behind a device that has been looking: the floor holds.
    expect(
      groupConversations(messages, { self: ME, floorAt: 2000, lastReadAt: { [key]: 500 } })[0]?.unreadCount,
    ).toBe(1)
  })

  it('still never counts our own messages', () => {
    const mine = [msg('mine', 4000, ME), msg('theirs', 3000, THEM)]
    expect(groupConversations(mine, { self: ME, floorAt: 0 })[0]?.unreadCount).toBe(1)
  })
})
