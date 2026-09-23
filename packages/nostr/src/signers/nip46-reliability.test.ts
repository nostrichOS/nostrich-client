import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  decrypt as decryptNip44,
  encrypt as encryptNip44,
  getConversationKey,
} from 'nostr-tools/nip44'
import type { SimplePool } from 'nostr-tools/pool'

import { Nip46Signer } from './nip46'
import type { Filter, Hex, NostrEvent, RelayUrl } from '../types'

/** Remote signing on a phone, and the one property everything else rests. */

interface Subscription {
  filter: Filter
  onevent: (event: NostrEvent) => void
}

/** An in-memory relay that forgets anything nobody was listening. */
class EphemeralRelay {
  readonly #subs = new Map<number, Subscription>()
  #next = 0
  /** Replies destroyed because no subscription was open. */
  dropped = 0
  delivered = 0

  subscribe(filter: Filter, onevent: (event: NostrEvent) => void): { close: () => void } {
    const id = (this.#next += 1)
    this.#subs.set(id, { filter, onevent })
    return { close: () => void this.#subs.delete(id) }
  }

  publish(event: NostrEvent): void {
    const targets = [...this.#subs.values()].filter(sub => this.#matches(sub.filter, event))
    if (targets.length === 0) {
      this.dropped += 1
      return
    }
    this.delivered += 1
    for (const sub of targets) sub.onevent(event)
  }

  #matches(filter: Filter, event: NostrEvent): boolean {
    if (filter.kinds !== undefined && !filter.kinds.includes(event.kind)) return false
    if (filter.authors !== undefined && !filter.authors.includes(event.pubkey)) return false
    const wanted = (filter as Record<string, unknown>)['#p'] as string[] | undefined
    if (wanted !== undefined) {
      const tagged = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1])
      if (!wanted.some(pubkey => tagged.includes(pubkey))) return false
    }
    return true
  }
}

/** The `SimplePool` shape `Nip46Signer` expects, over one relay. */
function poolOver(relay: EphemeralRelay): SimplePool {
  return {
    subscribe(_relays: RelayUrl[], filter: Filter, handlers: {
      onevent: (event: NostrEvent) => void
      oneose?: () => void
      onclose?: () => void
    }) {
      const handle = relay.subscribe(filter, handlers.onevent)
      // EOSE at once: the signer only ever publishes after our filter is live.
      handlers.oneose?.()
      return handle
    },
    publish(_relays: RelayUrl[], event: NostrEvent) {
      relay.publish(event)
      return [Promise.resolve('ok')]
    },
    close() {},
  } as unknown as SimplePool
}

/** The other end: a signer that can be asleep. */
class Bunker {
  readonly secret = generateSecretKey()
  readonly pubkey = getPublicKey(this.secret) as Hex
  readonly userSecret = generateSecretKey()
  readonly userPubkey = getPublicKey(this.userSecret) as Hex
  /** Every method it was asked for, including repeats. */
  readonly seen: string[] = []
  #handle: { close: () => void } | undefined

  constructor(private readonly relay: EphemeralRelay) {}

  wake(): void {
    if (this.#handle !== undefined) return
    this.#handle = this.relay.subscribe(
      { kinds: [24133], '#p': [this.pubkey] } as Filter,
      event => void this.#answer(event),
    )
  }

  sleep(): void {
    this.#handle?.close()
    this.#handle = undefined
  }

  #answer(event: NostrEvent): void {
    const key = getConversationKey(this.secret, event.pubkey as Hex)
    const body = JSON.parse(decryptNip44(event.content, key)) as {
      id: string
      method: string
      params: string[]
    }
    this.seen.push(body.method)
    if (body.method === 'logout') return

    const result =
      body.method === 'connect'
        ? 'ack'
        : body.method === 'get_public_key'
          ? this.userPubkey
          : body.method === 'sign_event'
            ? JSON.stringify(
                finalizeEvent(JSON.parse(body.params[0] ?? '{}') as never, this.userSecret),
              )
            : 'pong'

    this.relay.publish(
      finalizeEvent(
        {
          kind: 24133,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', event.pubkey]],
          content: encryptNip44(JSON.stringify({ id: body.id, result }), key),
        },
        this.secret,
      ),
    )
  }
}

/** A signer already paired with this bunker. */
function connected(
  relay: EphemeralRelay,
  bunker: Bunker,
  { timeoutMs = 400, knownUser = false }: { timeoutMs?: number; knownUser?: boolean } = {},
): Nip46Signer {
  return new Nip46Signer(
    { remoteSignerPubkey: bunker.pubkey, relays: ['wss://test.example'] as RelayUrl[] },
    {
      pool: poolOver(relay),
      alreadyPaired: true,
      timeoutMs,
      ...(knownUser ? { userPubkey: bunker.userPubkey } : {}),
    },
  )
}

const NOTE = { kind: 1, created_at: 1_800_000_000, tags: [], content: 'hello' }

describe('signing while the signer is awake', () => {
  it('signs a note', async () => {
    const relay = new EphemeralRelay()
    const bunker = new Bunker(relay)
    bunker.wake()
    const signer = connected(relay, bunker)

    const signed = await signer.signEvent(NOTE)
    expect(signed.pubkey).toBe(bunker.userPubkey)
    expect(relay.dropped).toBe(0)
    signer.close()
  })
})

describe('signing while the signer is ASLEEP, the phone case', () => {
  it('loses the answer, and recovers it on wake', async () => {
    const relay = new EphemeralRelay()
    const bunker = new Bunker(relay)
    const signer = connected(relay, bunker, { timeoutMs: 5_000, knownUser: true })

    /* The whole sequence, in the order a reader lives it: tap Like → we publish. */
    const pending = signer.signEvent(NOTE)
    // Waited for the DROP, not for silence: an assertion that is already true returns.
    await vi.waitFor(() => expect(relay.dropped).toBeGreaterThan(0))
    expect(bunker.seen).toEqual([])

    signer.sleep()
    bunker.wake()
    signer.wake()

    const signed = await pending
    expect(signed.pubkey).toBe(bunker.userPubkey)
    // Asked twice for one signature, which is the price of not losing.
    expect(bunker.seen).toEqual(['sign_event'])
    signer.close()
  })

  it('does not spend the deadline while the reader is away', async () => {
    // 120ms of budget against 500ms spent in the signer app.
    const relay = new EphemeralRelay()
    const bunker = new Bunker(relay)
    const signer = connected(relay, bunker, { timeoutMs: 120, knownUser: true })

    const pending = signer.signEvent(NOTE)
    let settled = false
    void pending.catch(() => {}).finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(relay.dropped).toBeGreaterThan(0))
    signer.sleep()

    await new Promise(resolve => setTimeout(resolve, 500))
    expect(settled).toBe(false)

    bunker.wake()
    signer.wake()
    await expect(pending).resolves.toMatchObject({ pubkey: bunker.userPubkey })
    signer.close()
  })

  it('gives up eventually rather than hanging for ever', async () => {
    // A paused clock must not become a stopped one: a signer that never wakes has to fail.
    const relay = new EphemeralRelay()
    const bunker = new Bunker(relay)
    const signer = connected(relay, bunker, { timeoutMs: 80, knownUser: true })

    const pending = signer.signEvent(NOTE)
    await expect(pending).rejects.toThrow(/did not answer/)
    signer.close()
  })
})

describe('several signatures at once', () => {
  it('recovers every one of them, matched to the right request', async () => {
    // Liking three notes quickly and then going to approve is ordinary.
    const relay = new EphemeralRelay()
    const bunker = new Bunker(relay)
    const signer = connected(relay, bunker, { timeoutMs: 5_000, knownUser: true })

    const notes = [1, 2, 3].map(n => ({ ...NOTE, content: `note ${n}` }))
    const pending = notes.map(note => signer.signEvent(note))
    await vi.waitFor(() => expect(relay.dropped).toBeGreaterThanOrEqual(3))

    signer.sleep()
    bunker.wake()
    signer.wake()

    const signed = await Promise.all(pending)
    expect(signed.map(event => event.content)).toEqual(['note 1', 'note 2', 'note 3'])
    signer.close()
  })
})

describe('logout', () => {
  it('reaches a signer that is awake, and closes either way', async () => {
    const relay = new EphemeralRelay()
    const bunker = new Bunker(relay)
    bunker.wake()
    const signer = connected(relay, bunker)

    await signer.signEvent(NOTE)
    await signer.logout()

    expect(bunker.seen).toContain('logout')
    await expect(signer.signEvent(NOTE)).rejects.toThrow(/closed/)
  })

  it('does not hang when the signer is asleep', async () => {
    // The spec calls logout a courtesy hint and requires the client to clean up.
    const relay = new EphemeralRelay()
    const bunker = new Bunker(relay)
    const signer = connected(relay, bunker)
    await signer.getPublicKey().catch(() => {})

    const started = Date.now()
    await signer.logout()
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
