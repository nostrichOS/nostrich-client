import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  decrypt as decryptNip44,
  encrypt as encryptNip44,
  getConversationKey,
} from 'nostr-tools/nip44'
import type { SimplePool } from 'nostr-tools/pool'
import { bytesToHex } from '@noble/hashes/utils'

import { Nip46Error, Nip46Signer, type Nip46Credential } from './nip46'
import type { Filter, Hex, NostrEvent, RelayUrl } from '../types'

/** Resuming a pairing. */

const REMOTE = getPublicKey(generateSecretKey()) as Hex
const RELAYS = ['wss://relay.example'] as RelayUrl[]

/** A signer that has completed a pairing, without doing any I/O to get there. */
function paired(): Nip46Signer {
  return new Nip46Signer(
    { remoteSignerPubkey: REMOTE, relays: RELAYS },
    { perms: ['sign_event:1', 'nip44_decrypt'], alreadyPaired: true },
  )
}

describe('toResumable', () => {
  it('says nothing until the pairing has actually happened', () => {
    // A cancelled QR screen or a bunker that refused us must never be written down.
    const unpaired = new Nip46Signer({ remoteSignerPubkey: REMOTE, relays: RELAYS })
    expect(unpaired.toResumable()).toBeUndefined()
  })

  it('carries everything needed to rebuild, and nothing else', () => {
    const credential = paired().toResumable()
    expect(credential).toBeDefined()
    expect(Object.keys(credential as object).sort()).toEqual([
      'clientSecretKey',
      'perms',
      'relays',
      'remoteSignerPubkey',
    ])
  })

  it('does not carry the single-use pairing secret', () => {
    // `secret` is spent by the first successful connect.
    const signer = new Nip46Signer(
      { remoteSignerPubkey: REMOTE, relays: RELAYS, secret: 'one-shot-token' },
      { alreadyPaired: true },
    )
    expect(JSON.stringify(signer.toResumable())).not.toContain('one-shot-token')
  })

  it('hands back copies, so a caller cannot mutate the live signer', () => {
    const signer = paired()
    const credential = signer.toResumable() as Nip46Credential
    credential.relays.push('wss://somewhere-else.example' as RelayUrl)
    expect(signer.relays).toEqual(RELAYS)
  })
})

describe('fromResumable', () => {
  it('round-trips to the same client identity the signer trusts', () => {
    // THE test.
    const original = paired()
    const restored = Nip46Signer.fromResumable(original.toResumable() as Nip46Credential)

    expect(restored.clientPublicKey).toBe(original.clientPublicKey)
    expect(restored.remoteSignerPublicKey).toBe(original.remoteSignerPublicKey)
    expect(restored.relays).toEqual(original.relays)
  })

  it('comes back already paired, so it never re-sends connect', () => {
    const restored = Nip46Signer.fromResumable(paired().toResumable() as Nip46Credential)
    // Observable through toResumable, which is undefined for an unpaired signer.
    expect(restored.toResumable()).toBeDefined()
  })

  it('preserves the granted permissions', () => {
    // They were frozen at connect.
    const restored = Nip46Signer.fromResumable(paired().toResumable() as Nip46Credential)
    expect(restored.toResumable()?.perms).toEqual(['sign_event:1', 'nip44_decrypt'])
  })

  it('refuses a key that is not hex', () => {
    expect(() =>
      Nip46Signer.fromResumable({
        clientSecretKey: 'not hex at all',
        remoteSignerPubkey: REMOTE,
        relays: RELAYS,
        perms: [],
      }),
    ).toThrow(Nip46Error)
  })

  it('refuses a key of the wrong length', () => {
    expect(() =>
      Nip46Signer.fromResumable({
        clientSecretKey: bytesToHex(generateSecretKey()).slice(0, 40),
        remoteSignerPubkey: REMOTE,
        relays: RELAYS,
        perms: [],
      }),
    ).toThrow(Nip46Error)
  })

  it('refuses 32 bytes that are not a valid curve scalar', () => {
    // Hand-edited or truncated storage.
    expect(() =>
      Nip46Signer.fromResumable({
        clientSecretKey: 'f'.repeat(64),
        remoteSignerPubkey: REMOTE,
        relays: RELAYS,
        perms: [],
      }),
    ).toThrow(Nip46Error)
  })

  it('refuses a pairing with no relays, like any other connection', () => {
    expect(() =>
      Nip46Signer.fromResumable({
        clientSecretKey: bytesToHex(generateSecretKey()),
        remoteSignerPubkey: REMOTE,
        relays: [],
        perms: [],
      }),
    ).toThrow(Nip46Error)
  })
})

/** WAKING A SIGNER WHOSE SOCKET DIED WHILE THE APP WAS AWAY. */
describe('wake', () => {
  /** A pool that records what it is asked to do and opens no sockets. */
  function recordingPool() {
    const state = { subscribes: 0, closes: 0 }
    const pool = {
      subscribe(_relays: string[], _filter: unknown, handlers: { oneose?: () => void }) {
        state.subscribes += 1
        // EOSE at once, so `#ensureSubscribed` resolves without waiting out its grace.
        handlers.oneose?.()
        return {
          close: () => {
            state.closes += 1
          },
        }
      },
      // One fulfilled publish, so the request is sent and then simply never answered.
      publish: () => [Promise.resolve('ok')],
      close: () => {},
    }
    return { pool: pool as never, state }
  }

  function signerOn(pool: never): Nip46Signer {
    return new Nip46Signer(
      { remoteSignerPubkey: REMOTE, relays: RELAYS },
      { alreadyPaired: true, pool, timeoutMs: 40 },
    )
  }

  it('does nothing for a signer that has never opened a subscription', () => {
    // Its first request subscribes anyway.
    const { pool, state } = recordingPool()
    signerOn(pool).wake()
    expect(state.subscribes).toBe(0)
  })

  it('recycles an open subscription when no session was ever established', async () => {
    // THE REPORTED STATE: paired, back from the signer app, nothing signed yet.
    const { pool, state } = recordingPool()
    const signer = signerOn(pool)

    await expect(signer.getPublicKey()).rejects.toThrow()
    expect(state.subscribes).toBe(1)
    expect(state.closes).toBe(0)

    signer.wake()
    expect(state.closes).toBe(1)
    expect(state.subscribes).toBe(2)
  })

  it('still does nothing once the signer has been closed for good', () => {
    const { pool, state } = recordingPool()
    const signer = signerOn(pool)
    signer.close()
    signer.wake()
    expect(state.subscribes).toBe(0)
  })
})

/** A RESTORED PAIRING ALREADY KNOWS WHO THE READER. */
describe('userPubkey', () => {
  function countingPool() {
    const state = { requests: 0 }
    const pool = {
      subscribe(_r: string[], _f: unknown, h: { oneose?: () => void }) {
        h.oneose?.()
        return { close: () => {} }
      },
      publish: () => {
        state.requests += 1
        return [Promise.resolve('ok')]
      },
      close: () => {},
    }
    return { pool: pool as never, state }
  }

  const USER = getPublicKey(generateSecretKey()) as Hex

  it('answers getPublicKey without asking the signer anything', async () => {
    const { pool, state } = countingPool()
    const signer = new Nip46Signer(
      { remoteSignerPubkey: REMOTE, relays: RELAYS },
      { alreadyPaired: true, pool, timeoutMs: 40, userPubkey: USER },
    )
    await expect(signer.getPublicKey()).resolves.toBe(USER)
    // Nothing was published, so the signer was never woken.
    expect(state.requests).toBe(0)
    signer.close()
  })

  it('asks the signer when the pubkey is not known', async () => {
    // A `bunker://` URI does not say who you are, so this path must stay.
    const { pool, state } = countingPool()
    const signer = new Nip46Signer(
      { remoteSignerPubkey: REMOTE, relays: RELAYS },
      { alreadyPaired: true, pool, timeoutMs: 40 },
    )
    await expect(signer.getPublicKey()).rejects.toThrow()
    expect(state.requests).toBe(1)
    signer.close()
  })
})

/** What happens to a request while the reader is away approving. */
describe('surviving the trip to the signer app', () => {
  const CLIENT_SECRET = generateSecretKey()
  const CLIENT_PUBKEY = getPublicKey(CLIENT_SECRET) as Hex

  /** A pool that records what was published and lets a test deliver a reply by hand. */
  function fakePool(): {
    pool: SimplePool
    published: NostrEvent[]
    deliver: (event: NostrEvent) => void
    subscriptions: number
  } {
    const published: NostrEvent[] = []
    let onevent: ((event: NostrEvent) => void) | undefined
    const state = { subscriptions: 0 }
    const pool = {
      subscribe(_relays: RelayUrl[], _filter: Filter, handlers: {
        onevent: (event: NostrEvent) => void
        oneose?: () => void
        onclose?: () => void
      }) {
        state.subscriptions += 1
        onevent = handlers.onevent
        // EOSE immediately: the signer only publishes once its filter is live.
        handlers.oneose?.()
        return { close: () => {} }
      },
      publish(_relays: RelayUrl[], event: NostrEvent) {
        published.push(event)
        return [Promise.resolve('ok')]
      },
      close() {},
    }
    return {
      pool: pool as unknown as SimplePool,
      published,
      deliver: (event: NostrEvent) => onevent?.(event),
      get subscriptions() {
        return state.subscriptions
      },
    }
  }

  /** The signer's side: encrypt a NIP-46 reply as the remote signer would. */
  function reply(remoteSecret: Uint8Array, id: string, result: string): NostrEvent {
    const key = getConversationKey(remoteSecret, CLIENT_PUBKEY)
    return finalizeEvent(
      {
        kind: 24133,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', CLIENT_PUBKEY]],
        content: encryptNip44(JSON.stringify({ id, result }), key),
      },
      remoteSecret,
    )
  }

  /** Reads the request id out of an event we published, the way the signer would. */
  function requestOf(remoteSecret: Uint8Array, event: NostrEvent): { id: string; method: string } {
    const key = getConversationKey(remoteSecret, CLIENT_PUBKEY)
    return JSON.parse(decryptNip44(event.content, key)) as { id: string; method: string }
  }

  function connected(pool: SimplePool): { signer: Nip46Signer; remoteSecret: Uint8Array } {
    const remoteSecret = generateSecretKey()
    const signer = new Nip46Signer(
      { remoteSignerPubkey: getPublicKey(remoteSecret) as Hex, relays: RELAYS },
      { pool, clientSecretKey: CLIENT_SECRET, alreadyPaired: true },
    )
    return { signer, remoteSecret }
  }

  it('asks again on wake, because the first answer was destroyed', async () => {
    const { pool, published, deliver } = fakePool()
    const { signer, remoteSecret } = connected(pool)

    const pending = signer.getPublicKey()
    await vi.waitFor(() => expect(published).toHaveLength(1))
    const first = requestOf(remoteSecret, published[0] as NostrEvent)

    // The reader is in the signer app: our socket is gone and the reply lands nowhere.
    signer.sleep()
    signer.wake()

    await vi.waitFor(() => expect(published).toHaveLength(2))
    const second = requestOf(remoteSecret, published[1] as NostrEvent)

    // Same question, asked again.
    expect(second.id).toBe(first.id)
    expect(second.method).toBe('get_public_key')
    // A DIFFERENT event, or a relay that has seen the id may forward it to nobody.
    expect((published[1] as NostrEvent).id).not.toBe((published[0] as NostrEvent).id)

    deliver(reply(remoteSecret, first.id, getPublicKey(remoteSecret)))
    await expect(pending).resolves.toBe(getPublicKey(remoteSecret))
    signer.close()
  })

  it('settles once when both attempts are answered', async () => {
    // The signer may well answer the resend too.
    const { pool, published, deliver } = fakePool()
    const { signer, remoteSecret } = connected(pool)

    const pending = signer.getPublicKey()
    await vi.waitFor(() => expect(published).toHaveLength(1))
    const { id } = requestOf(remoteSecret, published[0] as NostrEvent)
    signer.sleep()
    signer.wake()
    await vi.waitFor(() => expect(published).toHaveLength(2))

    deliver(reply(remoteSecret, id, getPublicKey(remoteSecret)))
    deliver(reply(remoteSecret, id, getPublicKey(remoteSecret)))
    await expect(pending).resolves.toBe(getPublicKey(remoteSecret))
    signer.close()
  })

  it('does not spend the deadline while the reader is away', async () => {
    /* A 150ms budget, then four times that spent "in the signer app". */
    const { pool, published } = fakePool()
    const remoteSecret = generateSecretKey()
    const signer = new Nip46Signer(
      { remoteSignerPubkey: getPublicKey(remoteSecret) as Hex, relays: RELAYS },
      { pool, clientSecretKey: CLIENT_SECRET, alreadyPaired: true, timeoutMs: 150 },
    )

    const pending = signer.getPublicKey()
    let settled = false
    void pending
      .catch(() => {})
      .finally(() => {
        settled = true
      })
    await vi.waitFor(() => expect(published).toHaveLength(1))
    signer.sleep()

    await new Promise(resolve => setTimeout(resolve, 600))
    expect(settled).toBe(false)
    signer.close()
  })

  it('re-arms the deadline on the way back', async () => {
    const { pool, published } = fakePool()
    const remoteSecret = generateSecretKey()
    const signer = new Nip46Signer(
      { remoteSignerPubkey: getPublicKey(remoteSecret) as Hex, relays: RELAYS },
      { pool, clientSecretKey: CLIENT_SECRET, alreadyPaired: true, timeoutMs: 20 },
    )

    const pending = signer.getPublicKey()
    signer.sleep()
    await vi.waitFor(() => expect(published).toHaveLength(1))
    signer.wake()
    // Woken, the budget runs again and an unanswered request eventually gives up rather.
    await expect(pending).rejects.toThrow(/did not answer/)
    signer.close()
  })
})

describe('logout', () => {
  const CLIENT_SECRET = generateSecretKey()

  it('tells the signer the session is over, then closes', async () => {
    const published: NostrEvent[] = []
    const pool = {
      subscribe: () => ({ close: () => {} }),
      publish: (_relays: RelayUrl[], event: NostrEvent) => {
        published.push(event)
        return [Promise.resolve('ok')]
      },
      close: () => {},
    } as unknown as SimplePool

    const remoteSecret = generateSecretKey()
    const signer = new Nip46Signer(
      { remoteSignerPubkey: getPublicKey(remoteSecret) as Hex, relays: RELAYS },
      { pool, clientSecretKey: CLIENT_SECRET, alreadyPaired: true },
    )

    await signer.logout()

    expect(published).toHaveLength(1)
    const key = getConversationKey(remoteSecret, getPublicKey(CLIENT_SECRET) as Hex)
    const sent = JSON.parse(decryptNip44((published[0] as NostrEvent).content, key)) as {
      method: string
      params: string[]
    }
    expect(sent.method).toBe('logout')
    expect(sent.params).toEqual([])

    // Closed, so nothing can be signed with it afterwards.
    await expect(signer.getPublicKey()).rejects.toThrow(/closed/)
  })

  it('says nothing when there was never a session', async () => {
    // Nothing was ever approved, so there is nothing at the signer to end.
    const published: NostrEvent[] = []
    const pool = {
      subscribe: () => ({ close: () => {} }),
      publish: (_relays: RelayUrl[], event: NostrEvent) => {
        published.push(event)
        return [Promise.resolve('ok')]
      },
      close: () => {},
    } as unknown as SimplePool

    const signer = new Nip46Signer(
      { remoteSignerPubkey: REMOTE, relays: RELAYS },
      { pool, clientSecretKey: CLIENT_SECRET },
    )
    await signer.logout()
    expect(published).toEqual([])
  })
})
