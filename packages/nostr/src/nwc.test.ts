import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '@noble/hashes/utils'
import * as nip04 from 'nostr-tools/nip04'
import * as nip44 from 'nostr-tools/nip44'

import { createNwcClient, parseWalletConnectUri } from './nwc'
import type { Filter, NostrEvent, Pool, SubscribeParams, SubscriptionHandle } from './types'

/** NIP-47, and specifically WHICH ENCRYPTION a wallet speaks. */

const walletSk = generateSecretKey()
const walletPubkey = getPublicKey(walletSk)

interface FakeWallet {
  /** What the wallet will decrypt. */
  speaks: 'nip04' | 'nip44_v2'
  /** The `encryption` tag on its kind-13194, or undefined to publish none. */
  advertises?: string
  /** Omit the info event entirely. */
  noInfo?: boolean
  /** What it answers in, when that differs from what it reads. */
  answersIn?: 'nip04' | 'nip44_v2'
  /** Answer every request with this NIP-47 error code instead of a result. */
  errorCode?: string
  /** Read the request and then say nothing. */
  mute?: boolean
  seen: { encryption: string | undefined; method?: string; params?: Record<string, unknown> }[]
}

function conversationKey(peer: string): Uint8Array {
  return nip44.v2.utils.getConversationKey(walletSk, peer)
}

/** A pool with one wallet behind. */
function poolFor(wallet: FakeWallet): Pool {
  const subscribers: ((event: NostrEvent, relay: string) => void)[] = []

  return {
    subscribe(params: SubscribeParams): SubscriptionHandle {
      if (params.onEvent !== undefined) subscribers.push(params.onEvent)
      return { close: () => undefined, relays: () => [] } as unknown as SubscriptionHandle
    },
    async publish(event: NostrEvent) {
      const tag = event.tags.find(t => t[0] === 'encryption')?.[1]
      // Recorded before decryption so unreadable attempts are counted too.
      const entry: {
        encryption: string | undefined
        method?: string
        params?: Record<string, unknown>
      } = { encryption: tag }
      wallet.seen.push(entry)

      let body: string
      try {
        body =
          wallet.speaks === 'nip04'
            ? await nip04.decrypt(walletSk, event.pubkey, event.content)
            : nip44.v2.decrypt(event.content, conversationKey(event.pubkey))
      } catch {
        // Unreadable.
        return [{ relay: 'wss://fake', ok: true }] as never
      }
      const parsed = JSON.parse(body) as { method: string; params?: Record<string, unknown> }
      const method = parsed.method
      entry.method = method
      entry.params = parsed.params
      // Read, understood, and deliberately unanswered.
      if (wallet.mute === true) return [{ relay: 'wss://fake', ok: true }] as never
      const payload =
        wallet.errorCode === undefined
          ? JSON.stringify({ result_type: method, result: { alias: 'Fake', balance: 1000, preimage: 'ff' } })
          : JSON.stringify({
              result_type: method,
              error: { code: wallet.errorCode, message: 'not enough sats' },
            })
      const answersIn = wallet.answersIn ?? wallet.speaks
      const content =
        answersIn === 'nip04'
          ? await nip04.encrypt(walletSk, event.pubkey, payload)
          : nip44.v2.encrypt(payload, conversationKey(event.pubkey))
      const response = finalizeEvent(
        {
          kind: 23195,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', event.pubkey], ['e', event.id]],
          content,
        },
        walletSk,
      )
      // Next tick, so the client has returned from publish and is listening.
      setTimeout(() => {
        for (const notify of subscribers) notify(response, 'wss://fake')
      }, 5)
      return [{ relay: 'wss://fake', ok: true }] as never
    },
    async query(filters: Filter[]) {
      if (wallet.noInfo === true || !filters.some(f => f.kinds?.includes(13194))) return []
      return [
        finalizeEvent(
          {
            kind: 13194,
            created_at: Math.floor(Date.now() / 1000),
            tags: wallet.advertises === undefined ? [] : [['encryption', wallet.advertises]],
            content: 'pay_invoice get_balance get_info',
          },
          walletSk,
        ),
      ]
    },
    async count() {
      return undefined
    },
    async queryWithStatus() {
      return { events: [], answered: 0, attempted: 0 }
    },
  } as unknown as Pool
}

function clientFor(wallet: FakeWallet, timeoutMs = 400) {
  const secret = bytesToHex(generateSecretKey())
  const uri = `nostr+walletconnect://${walletPubkey}?relay=wss://fake&secret=${secret}`
  const parsed = parseWalletConnectUri(uri)
  if (!parsed.ok) throw new Error('fixture URI did not parse')
  return createNwcClient({ connection: parsed.value, pool: poolFor(wallet), relays: ['wss://fake'], timeoutMs })
}

describe('encryption negotiation', () => {
  it('speaks NIP-04 to a wallet whose info event advertises no encryption', async () => {
    // The case that was broken.
    const wallet: FakeWallet = { speaks: 'nip04', seen: [] }
    const result = await clientFor(wallet).getInfo()
    expect(result.ok).toBe(true)
    expect(wallet.seen[0]?.encryption).toBeUndefined()
  })

  it('speaks NIP-44 to a wallet that advertises it', async () => {
    const wallet: FakeWallet = { speaks: 'nip44_v2', advertises: 'nip44_v2 nip04', seen: [] }
    const result = await clientFor(wallet).getInfo()
    expect(result.ok).toBe(true)
    expect(wallet.seen[0]?.encryption).toBe('nip44_v2')
  })

  it('prefers NIP-44 when a wallet lists both', async () => {
    const wallet: FakeWallet = { speaks: 'nip44_v2', advertises: 'nip04 nip44_v2', seen: [] }
    await clientFor(wallet).getInfo()
    expect(wallet.seen[0]?.encryption).toBe('nip44_v2')
  })

  it('retries in the other encryption when the first attempt is met with silence', async () => {
    // No info event to go on, so the client tries the modern one and gets nothing.
    const wallet: FakeWallet = { speaks: 'nip04', noInfo: true, seen: [] }
    const client = clientFor(wallet)
    const result = await client.getInfo()
    expect(result.ok).toBe(true)
    expect(wallet.seen.map(s => s.encryption)).toEqual(['nip44_v2', undefined])
  })

  it('remembers what worked, so the retry is paid once', async () => {
    const wallet: FakeWallet = { speaks: 'nip04', noInfo: true, seen: [] }
    const client = clientFor(wallet)
    await client.getInfo()
    await client.getBalance()
    // Three requests, not four: the second call goes straight to NIP-04.
    expect(wallet.seen).toHaveLength(3)
    expect(wallet.seen[2]?.encryption).toBeUndefined()
  })

  it('reads an answer that comes back in the other encryption', async () => {
    // Wallets do this: accept NIP-44 and reply NIP-04. Insisting on symmetry turns.
    const wallet: FakeWallet = { speaks: 'nip44_v2', advertises: 'nip44_v2', answersIn: 'nip04', seen: [] }
    const result = await clientFor(wallet).getInfo()
    expect(result.ok).toBe(true)
  })

  it('can be told the encryption outright, and then asks nobody', async () => {
    const wallet: FakeWallet = { speaks: 'nip04', seen: [] }
    const secret = bytesToHex(generateSecretKey())
    const parsed = parseWalletConnectUri(`nostr+walletconnect://${walletPubkey}?relay=wss://fake&secret=${secret}`)
    if (!parsed.ok) throw new Error('fixture URI did not parse')
    const client = createNwcClient({
      connection: parsed.value,
      pool: poolFor(wallet),
      relays: ['wss://fake'],
      timeoutMs: 400,
      encryption: 'nip04',
    })
    expect((await client.getInfo()).ok).toBe(true)
    expect(wallet.seen).toHaveLength(1)
  })
})

describe('parseWalletConnectUri', () => {
  it('keeps the lightning address a wallet includes', () => {
    const secret = bytesToHex(generateSecretKey())
    const parsed = parseWalletConnectUri(
      `nostr+walletconnect://${walletPubkey}?relay=wss://fake&secret=${secret}&lud16=me@wallet.test`,
    )
    expect(parsed.ok && parsed.value.lud16).toBe('me@wallet.test')
  })

  it('refuses a string with no secret rather than half-working', () => {
    expect(parseWalletConnectUri(`nostr+walletconnect://${walletPubkey}?relay=wss://fake`).ok).toBe(false)
  })
})

/** WHEN A REQUEST IS ALLOWED TO BE SENT TWICE. */
describe('retrying, and the money that depends on not retrying', () => {
  it('does not resend a request the wallet answered with an error', async () => {
    const wallet: FakeWallet = { speaks: 'nip04', advertises: 'nip04', errorCode: 'INSUFFICIENT_BALANCE', seen: [] }
    const result = await clientFor(wallet).getInfo()
    expect(result.ok).toBe(false)
    expect(wallet.seen).toHaveLength(1)
  })

  it('works the encryption out before paying, and still pays only once', async () => {
    /* This used to assert `result.ok === false`. */
    const wallet: FakeWallet = { speaks: 'nip04', noInfo: true, seen: [] }
    const result = await clientFor(wallet).payInvoice({ invoice: 'lnbc210n1pfake' })
    expect(result.ok).toBe(true)
    expect(wallet.seen.filter(s => s.method === 'pay_invoice')).toHaveLength(1)
  })

  it('still retries a harmless method while guessing', async () => {
    const wallet: FakeWallet = { speaks: 'nip04', noInfo: true, seen: [] }
    expect((await clientFor(wallet).getInfo()).ok).toBe(true)
    expect(wallet.seen).toHaveLength(2)
  })

  it('reports a wallet error as the wallet having answered', async () => {
    const wallet: FakeWallet = { speaks: 'nip04', advertises: 'nip04', errorCode: 'INSUFFICIENT_BALANCE', seen: [] }
    const result = await clientFor(wallet).payInvoice({ invoice: 'lnbc210n1pfake' })
    expect(result.ok).toBe(false)
    // `fromWallet` is what lets the UI say "declined" instead of "we do not know".
    expect(result.ok === false && result.error.fromWallet).toBe(true)
    expect(wallet.seen).toHaveLength(1)
  })

  it('reports silence as an unknown outcome, never as a refusal', async () => {
    const wallet: FakeWallet = { speaks: 'nip04', advertises: 'nip04', mute: true, seen: [] }
    const result = await clientFor(wallet).payInvoice({ invoice: 'lnbc210n1pfake' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.code).toBe('TIMEOUT')
    // The payment may have gone.
    expect(result.ok === false && result.error.fromWallet).toBe(false)
  })

  it('sends a payment exactly once to a wallet that is simply not answering', async () => {
    const wallet: FakeWallet = { speaks: 'nip04', advertises: 'nip04', mute: true, seen: [] }
    await clientFor(wallet).payInvoice({ invoice: 'lnbc210n1pfake' })
    // The encryption is known, so there is no scheme to fall back to and nothing to retry.
    expect(wallet.seen).toHaveLength(1)
  })
})

/** PAYING A WALLET THAT PUBLISHES NO INFO EVENT. */
describe('a payment never guesses the encryption', () => {
  const INVOICE = 'lnbc1u1pfakeinvoice'

  it('settles the scheme first, then pays a wallet that advertises nothing', async () => {
    const wallet: FakeWallet = { speaks: 'nip04', noInfo: true, seen: [] }
    const result = await clientFor(wallet).payInvoice({ invoice: INVOICE })
    expect(result.ok).toBe(true)
    // Probe in the guess, probe in the other, then the payment.
    expect(wallet.seen.map(s => s.method)).toEqual([undefined, 'get_info', 'pay_invoice'])
    expect(wallet.seen.at(-1)?.encryption).toBeUndefined()
  })

  it('sends the payment exactly once, whatever the probing cost', async () => {
    const wallet: FakeWallet = { speaks: 'nip04', noInfo: true, seen: [] }
    await clientFor(wallet).payInvoice({ invoice: INVOICE })
    expect(wallet.seen.filter(s => s.method === 'pay_invoice')).toHaveLength(1)
  })

  it('does not probe when the wallet already said which it speaks', async () => {
    const wallet: FakeWallet = { speaks: 'nip44_v2', advertises: 'nip44_v2', seen: [] }
    const result = await clientFor(wallet).payInvoice({ invoice: INVOICE })
    expect(result.ok).toBe(true)
    expect(wallet.seen.map(s => s.method)).toEqual(['pay_invoice'])
  })

  it('treats a wallet error as proof the encryption is right, and still pays in it', async () => {
    // The probe comes back refused rather than answered.
    const wallet: FakeWallet = { speaks: 'nip04', noInfo: true, errorCode: 'INSUFFICIENT_BALANCE', seen: [] }
    const result = await clientFor(wallet).payInvoice({ invoice: INVOICE })
    expect(result.ok).toBe(false)
    expect(wallet.seen.filter(s => s.method === 'pay_invoice')).toHaveLength(1)
  })

  it('still refuses to send a second payment when nothing answers at all', async () => {
    /* Nothing can be settled here: both probes time out, so the payment goes out. */
    const wallet: FakeWallet = { speaks: 'nip04', noInfo: true, mute: true, seen: [] }
    const result = await clientFor(wallet).payInvoice({ invoice: INVOICE })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT')
    expect(wallet.seen).toHaveLength(3)
  })
})

/** TELLING THE WALLET WHAT IT IS PAYING. */
describe('pay_invoice metadata', () => {
  const advertised: Omit<FakeWallet, 'seen'> = { speaks: 'nip44_v2', advertises: 'nip44_v2' }
  const zapRequest = { kind: 9734, id: 'a'.repeat(64), content: 'nice one' }

  it('forwards it to the wallet', async () => {
    const wallet: FakeWallet = { ...advertised, seen: [] }
    await clientFor(wallet).payInvoice({ invoice: 'lnbc1u1pfake', metadata: { nostr: zapRequest } })
    expect(wallet.seen.at(-1)?.params?.['metadata']).toEqual({ nostr: zapRequest })
  })

  it('sends no metadata key at all when there is nothing to say', async () => {
    // A payment that is not a zap must not carry an empty field describing it as one.
    const wallet: FakeWallet = { ...advertised, seen: [] }
    await clientFor(wallet).payInvoice({ invoice: 'lnbc1u1pfake' })
    expect(wallet.seen.at(-1)?.params).not.toHaveProperty('metadata')
  })

  it('drops metadata past the 4096-character cap rather than sending it', async () => {
    /* The spec says a wallet MUST drop anything larger, so what arrives is the same. */
    const wallet: FakeWallet = { ...advertised, seen: [] }
    const huge = { nostr: { ...zapRequest, content: 'x'.repeat(5000) } }
    await clientFor(wallet).payInvoice({ invoice: 'lnbc1u1pfake', metadata: huge })
    expect(wallet.seen.at(-1)?.params).not.toHaveProperty('metadata')
  })

  it('keeps metadata that sits just under the cap', async () => {
    const wallet: FakeWallet = { ...advertised, seen: [] }
    const snug = { nostr: { ...zapRequest, content: 'x'.repeat(3900) } }
    await clientFor(wallet).payInvoice({ invoice: 'lnbc1u1pfake', metadata: snug })
    expect(wallet.seen.at(-1)?.params?.['metadata']).toEqual(snug)
  })
})

describe('getBudget', () => {
  /** The method exists to explain a balance that looks wrong: several wallets answer. */
  it('treats a wallet with no budget fields as having no budget', async () => {
    // The fake answers every method with the same object, which carries no budget fields.
    const wallet: FakeWallet = { speaks: 'nip44_v2', advertises: 'nip44_v2', seen: [] }
    const res = await clientFor(wallet).getBudget()
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.totalMsat).toBe(0)
      expect(res.value.usedMsat).toBe(0)
    }
  })

  it('a refusal is an answer, not a crash', async () => {
    // `get_budget` is optional in NIP-47. A wallet that does not implement it errors.
    const wallet: FakeWallet = {
      speaks: 'nip44_v2',
      advertises: 'nip44_v2',
      errorCode: 'NOT_IMPLEMENTED',
      seen: [],
    }
    const res = await clientFor(wallet).getBudget()
    expect(res.ok).toBe(false)
  })

  it('asks for get_budget by name', async () => {
    const wallet: FakeWallet = { speaks: 'nip44_v2', advertises: 'nip44_v2', seen: [] }
    await clientFor(wallet).getBudget()
    expect(wallet.seen.some(entry => entry.method === 'get_budget')).toBe(true)
  })
})

describe('advertisedMethods', () => {
  /* Why this matters more than it looks: a refusal is silent in OUR client. */
  it('reads the command list from the wallet kind-13194', async () => {
    const wallet: FakeWallet = { speaks: 'nip44_v2', advertises: 'nip44_v2', seen: [] }
    const methods = await clientFor(wallet).advertisedMethods()
    expect(methods).toEqual(['pay_invoice', 'get_balance', 'get_info'])
    // The list is what lets a caller skip get_budget without asking.
    expect(methods?.includes('get_budget')).toBe(false)
  })

  it('costs no extra request, the info event is already fetched to negotiate encryption', async () => {
    const wallet: FakeWallet = { speaks: 'nip44_v2', advertises: 'nip44_v2', seen: [] }
    const client = clientFor(wallet)
    await client.advertisedMethods()
    // Reading the advertisement must not put a NIP-47 request on the wire at all.
    expect(wallet.seen).toEqual([])
  })

  it('is undefined when the wallet publishes no advertisement', async () => {
    /* "Never said" is not "unsupported". */
    const wallet: FakeWallet = { speaks: 'nip04', noInfo: true, seen: [] }
    expect(await clientFor(wallet).advertisedMethods()).toBeUndefined()
  })
})
