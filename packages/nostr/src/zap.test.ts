import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils'
import type { EventTemplate, Hex, NostrEvent, Signer } from './types'
import {
  forgetVerifiedSignatures,
  MAX_ZAP_REQUEST_RELAYS,
  buildZapRequest,
  createZapInvoice,
  decodeBolt11,
  encodeLnurl,
  lightningAddressToUrl,
  lnurlToUrl,
  validateZapReceipt,
  zapEndpointUrl,
  type FetchLike,
  parseLnurlPayParams,
} from './zap'

// --------------------------------------------------------------------------- Fixtures.

const SENDER_KEY = generateSecretKey()
const SENDER = getPublicKey(SENDER_KEY)
const RECIPIENT = getPublicKey(generateSecretKey())
const SERVER_KEY = generateSecretKey()
const SERVER = getPublicKey(SERVER_KEY)
const ATTACKER_KEY = generateSecretKey()

const NOTE_ID = bytesToHex(sha256(utf8ToBytes('a note being zapped')))
const RELAYS = ['wss://relay-a.example', 'wss://nos.lol']

function testSigner(secretKey: Uint8Array): Signer {
  const pubkey = getPublicKey(secretKey)
  return {
    kind: 'privatekey',
    async getPublicKey() {
      return pubkey
    },
    async signEvent(template: EventTemplate) {
      return finalizeEvent({ ...template, tags: template.tags.map((tag) => [...tag]) }, secretKey)
    },
    async nip44Encrypt() {
      throw new Error('not used by zaps')
    },
    async nip44Decrypt() {
      throw new Error('not used by zaps')
    },
  }
}

const sender = testSigner(SENDER_KEY)

function sha256Hex(input: string): Hex {
  return bytesToHex(sha256(utf8ToBytes(input)))
}

/** nostr-tools caches the verification verdict in a symbol on the event object. */
function tamper(event: NostrEvent, patch: Partial<NostrEvent>): NostrEvent {
  return { ...(JSON.parse(JSON.stringify(event)) as NostrEvent), ...patch }
}

function signReceipt(
  secretKey: Uint8Array,
  { description, bolt11, eventId }: { description: string; bolt11: string; eventId?: Hex },
): NostrEvent {
  const tags: string[][] = [
    ['p', RECIPIENT],
    ['bolt11', bolt11],
    ['description', description],
    ['preimage', bytesToHex(sha256(utf8ToBytes(bolt11)))],
  ]
  if (eventId) tags.push(['e', eventId])
  return finalizeEvent({ kind: 9735, created_at: 1_700_000_100, tags, content: '' }, secretKey)
}

// --------------------------------------------------------------------------- bolt11.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) checksum ^= GENERATOR[i] ?? 0
  }
  return checksum
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = []
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5)
  out.push(0)
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31)
  return out
}

function bech32(hrp: string, words: number[]): string {
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31)
  let out = `${hrp}1`
  for (const word of [...words, ...checksum]) out += CHARSET.charAt(word)
  return out
}

function toWords(bytes: Uint8Array): number[] {
  let acc = 0
  let bits = 0
  const out: number[] = []
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out.push((acc >> bits) & 31)
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31)
  return out
}

function amountToHrp(msat: number): string {
  if (msat % 100_000_000 === 0) return `${msat / 100_000_000}m`
  if (msat % 100_000 === 0) return `${msat / 100_000}u`
  if (msat % 100 === 0) return `${msat / 100}n`
  return `${msat * 10}p`
}

function field(type: number, data: number[]): number[] {
  return [type, Math.floor(data.length / 32), data.length % 32, ...data]
}

function makeInvoice(amountMsat: number, commitment: { descriptionHash?: Hex; description?: string }): string {
  const words: number[] = []
  let timestamp = 1_700_000_000
  const timestampWords: number[] = []
  for (let i = 0; i < 7; i++) {
    timestampWords.unshift(timestamp % 32)
    timestamp = Math.floor(timestamp / 32)
  }
  words.push(...timestampWords)
  words.push(...field(1, toWords(sha256(utf8ToBytes(`payment-${amountMsat}`)))))
  if (commitment.descriptionHash) words.push(...field(23, toWords(hexToBytes(commitment.descriptionHash))))
  if (commitment.description) words.push(...field(13, toWords(utf8ToBytes(commitment.description))))
  // 520 bits of signature.
  words.push(...new Array<number>(104).fill(0))
  return bech32(`lnbc${amountToHrp(amountMsat)}`, words)
}

// ---------------------------------------------------------------------------.

describe('lightning address resolution', () => {
  it('derives the LUD-16 well-known URL', () => {
    expect(lightningAddressToUrl('alice@getalby.com')).toBe('https://getalby.com/.well-known/lnurlp/alice')
  })

  it('strips the ₿ sigil users paste along with the address', () => {
    expect(lightningAddressToUrl('₿ alice@getalby.com'.replace(' ', ''))).toBe(
      'https://getalby.com/.well-known/lnurlp/alice',
    )
  })

  it('folds the domain but not the local part', () => {
    expect(lightningAddressToUrl('Alice@GetAlby.COM')).toBe('https://getalby.com/.well-known/lnurlp/Alice')
  })

  it('uses plain http for onion hosts, which have no CA certificate', () => {
    expect(lightningAddressToUrl('pay@abcdef.onion')).toBe('http://abcdef.onion/.well-known/lnurlp/pay')
  })

  it('rejects addresses that are not addresses', () => {
    expect(lightningAddressToUrl('alice')).toBeNull()
    expect(lightningAddressToUrl('@getalby.com')).toBeNull()
    expect(lightningAddressToUrl('alice@')).toBeNull()
    expect(lightningAddressToUrl('alice@localhost')).toBeNull()
    expect(lightningAddressToUrl('alice bob@getalby.com')).toBeNull()
  })

  it('refuses a name that would climb out of /.well-known/', () => {
    expect(lightningAddressToUrl('..@getalby.com')).toBeNull()
  })

  it('decodes a LUD-06 bech32 LNURL', () => {
    const url = 'https://getalby.com/.well-known/lnurlp/alice'
    const lnurl = encodeLnurl(url)
    expect(lnurl.startsWith('lnurl1')).toBe(true)
    expect(lnurlToUrl(lnurl)).toBe(url)
    expect(lnurlToUrl(lnurl.toUpperCase())).toBe(url)
    expect(lnurlToUrl(`lightning:${lnurl}`)).toBe(url)
  })

  it('rejects a corrupted LNURL instead of decoding it into garbage', () => {
    const lnurl = encodeLnurl('https://getalby.com/.well-known/lnurlp/alice')
    expect(lnurlToUrl(`${lnurl.slice(0, -1)}q`)).toBeNull()
  })

  it('prefers lud16 and falls back to lud06', () => {
    const lnurl = encodeLnurl('https://zbd.gg/.well-known/lnurlp/bob')
    expect(zapEndpointUrl({ lud16: 'alice@getalby.com', lud06: lnurl })).toBe(
      'https://getalby.com/.well-known/lnurlp/alice',
    )
    expect(zapEndpointUrl({ lud06: lnurl })).toBe('https://zbd.gg/.well-known/lnurlp/bob')
    expect(zapEndpointUrl({})).toBeNull()
  })
})

describe('bolt11 decoding', () => {
  it('reads amount and description hash off a BOLT-11 spec vector', () => {
    // "Now send $24 for an entire list of things (hashed)" from the BOLT-11 test vectors.
    const invoice =
      'lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qrsgq7ea976txfraylvgzuxs8kgcw23ezlrszfnh8r6qtfpr6cxga50aj6txm9rxrydzd06dfeawfk6swupvz4erwnyutnjq7x39ymw6j38gp7ynn44'
    const decoded = decodeBolt11(invoice)
    expect(decoded).not.toBeNull()
    expect(decoded?.amountMsat).toBe(2_000_000_000)
    expect(decoded?.timestamp).toBe(1_496_314_658)
    expect(decoded?.descriptionHash).toBe('3925b6f67e2c340036ed12093dd44e0368df1b6ea26c53dbe4811f58fd5db8c1')
    expect(decoded?.paymentHash).toBe('0001020304050607080900010203040506070809000102030405060708090102')
  })

  it('rejects a mangled invoice rather than guessing', () => {
    expect(decodeBolt11('lnbc20m1pvjluezpp5nonsense')).toBeNull()
    expect(decodeBolt11('not an invoice')).toBeNull()
  })
})

describe('zap request construction', () => {
  it('carries relays, millisats, p and e tags', async () => {
    const request = await buildZapRequest(
      {
        recipientPubkey: RECIPIENT,
        eventId: NOTE_ID,
        amountMsat: 21_000_000,
        comment: 'onward',
        relays: RELAYS,
        lnurl: encodeLnurl('https://getalby.com/.well-known/lnurlp/alice'),
      },
      sender,
    )

    expect(request.kind).toBe(9734)
    expect(request.pubkey).toBe(SENDER)
    expect(request.content).toBe('onward')
    expect(request.tags).toContainEqual(['relays', ...RELAYS])
    expect(request.tags).toContainEqual(['amount', '21000000'])
    expect(request.tags).toContainEqual(['p', RECIPIENT])
    expect(request.tags).toContainEqual(['e', NOTE_ID])
    expect(request.tags.some((tag) => tag[0] === 'lnurl')).toBe(true)
  })

  it('omits e and a when zapping a profile', async () => {
    const request = await buildZapRequest(
      { recipientPubkey: RECIPIENT, amountMsat: 1000, relays: RELAYS },
      sender,
    )
    expect(request.tags.some((tag) => tag[0] === 'e')).toBe(false)
    expect(request.tags.some((tag) => tag[0] === 'a')).toBe(false)
    expect(request.content).toBe('')
  })

  it('tags a replaceable event with a coordinate', async () => {
    const address = `30023:${RECIPIENT}:my-article`
    const request = await buildZapRequest(
      { recipientPubkey: RECIPIENT, amountMsat: 1000, relays: RELAYS, address },
      sender,
    )
    expect(request.tags).toContainEqual(['a', address])
  })

  it('caps the relay list so the callback URL stays under CDN limits', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `wss://relay-${i}.example`)
    const request = await buildZapRequest(
      { recipientPubkey: RECIPIENT, amountMsat: 1000, relays: many },
      sender,
    )
    const relayTag = request.tags.find((tag) => tag[0] === 'relays') ?? []
    expect(relayTag.length - 1).toBe(MAX_ZAP_REQUEST_RELAYS)
  })

  it('refuses bech32 and bad amounts', async () => {
    await expect(
      buildZapRequest(
        { recipientPubkey: 'npub1abcdef', amountMsat: 1000, relays: RELAYS },
        sender,
      ),
    ).rejects.toThrow(TypeError)
    await expect(
      buildZapRequest({ recipientPubkey: RECIPIENT, amountMsat: 0, relays: RELAYS }, sender),
    ).rejects.toThrow(RangeError)
    await expect(
      buildZapRequest({ recipientPubkey: RECIPIENT, amountMsat: 1500.5, relays: RELAYS }, sender),
    ).rejects.toThrow(RangeError)
    await expect(
      buildZapRequest({ recipientPubkey: RECIPIENT, amountMsat: 1000, relays: [] }, sender),
    ).rejects.toThrow(RangeError)
  })
})

describe('a recipient who cannot receive', () => {
  /** `maxSendable: 0` is a well-formed document saying "nothing right now". */
  it('says the recipient cannot receive, not that their profile is malformed', () => {
    const res = parseLnurlPayParams(
      {
        tag: 'payRequest',
        callback: 'https://getalby.com/lnurlp/alice/callback',
        minSendable: 1000,
        maxSendable: 0,
        metadata: '[["text/plain","sats"]]',
      },
      'https://getalby.com/.well-known/lnurlp/alice',
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.message).toMatch(/cannot receive/i)
    expect(res.error.message).not.toMatch(/min\/maxSendable/)
  })

  it('still reports a genuinely malformed range as malformed', () => {
    const res = parseLnurlPayParams(
      {
        tag: 'payRequest',
        callback: 'https://getalby.com/lnurlp/alice/callback',
        minSendable: 5000,
        maxSendable: 1000,
        metadata: '[["text/plain","sats"]]',
      },
      'https://getalby.com/.well-known/lnurlp/alice',
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.message).toMatch(/min\/maxSendable/)
  })
})

describe('createZapInvoice', () => {
  const METADATA = JSON.stringify([['text/plain', 'zap alice']])

  function server(params: Record<string, unknown>, ignoreNostr = false): FetchLike {
    return async (url) => {
      const parsed = new URL(url)
      let body: unknown
      if (parsed.pathname === '/.well-known/lnurlp/alice') {
        body = {
          tag: 'payRequest',
          callback: 'https://getalby.com/lnurlp/alice/callback',
          minSendable: 1000,
          maxSendable: 100_000_000_000,
          metadata: METADATA,
          ...params,
        }
      } else {
        const nostr = parsed.searchParams.get('nostr')
        const amount = Number(parsed.searchParams.get('amount'))
        const zapping = nostr !== null && params['allowsNostr'] === true && !ignoreNostr
        const commitment = zapping && nostr !== null ? sha256Hex(nostr) : sha256Hex(METADATA)
        body = { pr: makeInvoice(amount, { descriptionHash: commitment }) }
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return body
        },
      }
    }
  }

  it('produces a zap invoice committed to the signed request', async () => {
    const res = await createZapInvoice({
      target: { recipientPubkey: RECIPIENT, eventId: NOTE_ID, amountMsat: 21_000_000, relays: RELAYS },
      recipient: { lud16: 'alice@getalby.com' },
      signer: sender,
      http: { fetch: server({ allowsNostr: true, nostrPubkey: SERVER }) },
    })

    expect(res.ok).toBe(true)
    if (!res.ok || !res.value.zap) throw new Error('expected a zap invoice')
    expect(res.value.lnurlPubkey).toBe(SERVER)
    expect(res.value.amountMsat).toBe(21_000_000)
    expect(res.value.zapRequest.pubkey).toBe(SENDER)
    expect(decodeBolt11(res.value.bolt11)?.descriptionHash).toBe(sha256Hex(JSON.stringify(res.value.zapRequest)))
  })

  it('accepts an npub in nostrPubkey, because servers publish them', async () => {
    const res = await createZapInvoice({
      target: { recipientPubkey: RECIPIENT, amountMsat: 21_000_000, relays: RELAYS },
      recipient: { lud16: 'alice@getalby.com' },
      signer: sender,
      // npub of SERVER, produced the way a misconfigured LNURL server would.
      http: { fetch: server({ allowsNostr: true, nostrPubkey: npubOf(SERVER) }) },
    })
    if (!res.ok || !res.value.zap) throw new Error('expected a zap invoice')
    expect(res.value.lnurlPubkey).toBe(SERVER)
  })

  it('falls back to a plain payment when the server does not do nostr', async () => {
    const res = await createZapInvoice({
      target: { recipientPubkey: RECIPIENT, amountMsat: 21_000_000, relays: RELAYS },
      recipient: { lud16: 'alice@getalby.com' },
      signer: sender,
      http: { fetch: server({}) },
    })

    expect(res.ok).toBe(true)
    if (!res.ok || res.value.zap) throw new Error('expected the non-zap fallback')
    expect(res.value.reason).toBe('no-nostr-support')
    expect(res.value.bolt11.startsWith('lnbc')).toBe(true)
  })

  it('PAYS an invoice that commits to something we cannot match, and marks it unverified', async () => {
    /* This test used to assert the opposite, and the assumption it encoded was false. */
    const res = await createZapInvoice({
      target: { recipientPubkey: RECIPIENT, amountMsat: 21_000_000, relays: RELAYS },
      recipient: { lud16: 'alice@getalby.com' },
      signer: sender,
      http: { fetch: server({ allowsNostr: true, nostrPubkey: SERVER }, true) },
    })

    expect(res.ok).toBe(true)
    if (!res.ok || !res.value.zap) throw new Error('expected a zap invoice')
    // Payable, but not evidence: the Top zaps panel reads this flag.
    expect(res.value.verified).toBe(false)
    expect(res.value.bolt11.startsWith('lnbc')).toBe(true)
  })

  it('rejects an amount the server will not take', async () => {
    const res = await createZapInvoice({
      target: { recipientPubkey: RECIPIENT, amountMsat: 1, relays: RELAYS },
      recipient: { lud16: 'alice@getalby.com' },
      signer: sender,
      http: { fetch: server({ allowsNostr: true, nostrPubkey: SERVER }) },
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.code).toBe('amount-out-of-range')
  })

  it('reports a profile with no lightning address', async () => {
    const res = await createZapInvoice({
      target: { recipientPubkey: RECIPIENT, amountMsat: 1000, relays: RELAYS },
      recipient: {},
      signer: sender,
      http: { fetch: server({ allowsNostr: true, nostrPubkey: SERVER }) },
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.code).toBe('no-lightning-address')
  })
})

describe('validateZapReceipt', () => {
  const AMOUNT = 21_000_000

  async function fixture(): Promise<{ description: string; bolt11: string }> {
    const zapRequest = await buildZapRequest(
      { recipientPubkey: RECIPIENT, eventId: NOTE_ID, amountMsat: AMOUNT, comment: 'nice note', relays: RELAYS },
      sender,
    )
    const description = JSON.stringify(zapRequest)
    return { description, bolt11: makeInvoice(AMOUNT, { descriptionHash: sha256Hex(description) }) }
  }

  it('accepts a receipt from the recipient LNURL server and reports the real sender', async () => {
    const { description, bolt11 } = await fixture()
    const receipt = signReceipt(SERVER_KEY, { description, bolt11, eventId: NOTE_ID })

    const res = validateZapReceipt({ receipt, lnurlPubkey: SERVER, recipientPubkey: RECIPIENT, eventId: NOTE_ID })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error.message)

    expect(res.value.senderPubkey).toBe(SENDER)
    expect(res.value.senderPubkey).not.toBe(receipt.pubkey)
    expect(res.value.recipientPubkey).toBe(RECIPIENT)
    expect(res.value.eventId).toBe(NOTE_ID)
    expect(res.value.amountMsat).toBe(AMOUNT)
    expect(res.value.comment).toBe('nice note')
    expect(res.value.bolt11).toBe(bolt11)
  })

  /** A RECEIPT FROM ANOTHER KEY IS UNCONFIRMED, NOT REJECTED. */
  it('accepts a receipt from another key but marks it unconfirmed', async () => {
    const { description, bolt11 } = await fixture()

    const other = signReceipt(ATTACKER_KEY, { description, bolt11, eventId: NOTE_ID })
    const res = validateZapReceipt({ receipt: other, lnurlPubkey: SERVER, recipientPubkey: RECIPIENT })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.value.issuerVerified).toBe(false)
    // The sender still comes from the signed zap request, never from whoever signed.
    expect(res.value.senderPubkey).not.toBe(getPublicKey(ATTACKER_KEY))

    const selfIssued = signReceipt(SENDER_KEY, { description, bolt11, eventId: NOTE_ID })
    const self = validateZapReceipt({ receipt: selfIssued, lnurlPubkey: SERVER, recipientPubkey: RECIPIENT })
    expect(self.ok && self.value.issuerVerified).toBe(false)
  })

  it('marks the recipient own server as confirmed', async () => {
    const { description, bolt11 } = await fixture()
    const real = signReceipt(SERVER_KEY, { description, bolt11, eventId: NOTE_ID })
    const res = validateZapReceipt({ receipt: real, lnurlPubkey: SERVER, recipientPubkey: RECIPIENT })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.value.issuerVerified).toBe(true)
  })

  it('is unconfirmed when there is no server key to check against at all', async () => {
    const { description, bolt11 } = await fixture()
    const real = signReceipt(SERVER_KEY, { description, bolt11, eventId: NOTE_ID })
    const res = validateZapReceipt({ receipt: real, recipientPubkey: RECIPIENT })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.value.issuerVerified).toBe(false)
  })

  /** The checks that still have to hold, because dropping the issuer requirement. */
  it('still refuses a receipt whose zap request is not validly signed', async () => {
    const { description, bolt11 } = await fixture()
    const tampered = JSON.parse(description) as { content: string }
    tampered.content = 'not what was signed'
    const receipt = signReceipt(SERVER_KEY, { description: JSON.stringify(tampered), bolt11, eventId: NOTE_ID })
    const res = validateZapReceipt({ receipt, lnurlPubkey: SERVER, recipientPubkey: RECIPIENT })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.code).toBe('bad-zap-request')
  })

  it('still refuses a receipt addressed to somebody else', async () => {
    const { description, bolt11 } = await fixture()
    const receipt = signReceipt(ATTACKER_KEY, { description, bolt11, eventId: NOTE_ID })
    const res = validateZapReceipt({ receipt, recipientPubkey: getPublicKey(ATTACKER_KEY) })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.code).toBe('target-mismatch')
  })

  it('still rejects a real invoice re-labelled with an inflated zap request', async () => {
    const { bolt11 } = await fixture()

    // A real 21k-sat invoice, re-labelled with a zap request claiming a million sats.
    const inflated = await buildZapRequest(
      { recipientPubkey: RECIPIENT, eventId: NOTE_ID, amountMsat: 100_000_000_000, relays: RELAYS },
      sender,
    )
    const receipt = signReceipt(SERVER_KEY, {
      description: JSON.stringify(inflated),
      bolt11,
      eventId: NOTE_ID,
    })

    // The description hash no longer rejects on its own.
    const res = validateZapReceipt({ receipt, lnurlPubkey: SERVER, recipientPubkey: RECIPIENT })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.code).toBe('amount-mismatch')
  })

  it('accepts a re-serialised description but does not claim the sender is proven', async () => {
    const { description, bolt11 } = await fixture()

    // Same request, same amount, different bytes.
    const receipt = signReceipt(SERVER_KEY, {
      description: `${description} `,
      bolt11,
      eventId: NOTE_ID,
    })

    const res = validateZapReceipt({ receipt, lnurlPubkey: SERVER, recipientPubkey: RECIPIENT })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    // The zap is real: the recipient's own server signed it, for them, for this amount.
    expect(res.value.amountMsat).toBe(AMOUNT)
    // But nothing ties this payment to that sender, and the flag has to say.
    expect(res.value.senderVerified).toBe(false)
  })

  it('marks the sender as proven when the hash does commit', async () => {
    const { description, bolt11 } = await fixture()
    const receipt = signReceipt(SERVER_KEY, { description, bolt11, eventId: NOTE_ID })
    const res = validateZapReceipt({ receipt, lnurlPubkey: SERVER, recipientPubkey: RECIPIENT })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.value.senderVerified).toBe(true)
  })

  it('rejects a receipt whose invoice pays a different amount than the request', async () => {
    const zapRequest = await buildZapRequest(
      { recipientPubkey: RECIPIENT, amountMsat: AMOUNT, relays: RELAYS },
      sender,
    )
    const description = JSON.stringify(zapRequest)
    const receipt = signReceipt(SERVER_KEY, {
      description,
      bolt11: makeInvoice(1_000, { descriptionHash: sha256Hex(description) }),
    })

    const res = validateZapReceipt({ receipt, lnurlPubkey: SERVER })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.code).toBe('amount-mismatch')
  })

  it('rejects a tampered receipt', async () => {
    const { description, bolt11 } = await fixture()
    const receipt = signReceipt(SERVER_KEY, { description, bolt11, eventId: NOTE_ID })

    const res = validateZapReceipt({
      receipt: tamper(receipt, { created_at: receipt.created_at + 1 }),
      lnurlPubkey: SERVER,
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.code).toBe('bad-signature')
  })

  it('rejects a receipt for a note we did not ask about', async () => {
    const { description, bolt11 } = await fixture()
    const receipt = signReceipt(SERVER_KEY, { description, bolt11, eventId: NOTE_ID })

    const res = validateZapReceipt({
      receipt,
      lnurlPubkey: SERVER,
      eventId: bytesToHex(sha256(utf8ToBytes('some other note'))),
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.code).toBe('target-mismatch')
  })

  it('rejects anything that is not a kind-9735', async () => {
    const { description, bolt11 } = await fixture()
    const receipt = signReceipt(SERVER_KEY, { description, bolt11 })
    const res = validateZapReceipt({ receipt: tamper(receipt, { kind: 1 }), lnurlPubkey: SERVER })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.code).toBe('not-a-zap-receipt')
  })
})

function npubOf(pubkey: Hex): string {
  return bech32('npub', toWords(hexToBytes(pubkey)))
}

describe('an invoice that commits to nothing', () => {
  const METADATA = JSON.stringify([['text/plain', 'zap alice']])

  /** A server that takes the nostr param and returns an invoice committing to nothing. */
  function uncommitted(
    commitment: { descriptionHash?: Hex; description?: string },
    /** Bill a different number than was asked. */
    billMsat?: number,
  ): FetchLike {
    return async (url) => {
      const parsed = new URL(url)
      const body =
        parsed.pathname === '/.well-known/lnurlp/alice'
          ? {
              tag: 'payRequest',
              callback: 'https://getalby.com/lnurlp/alice/callback',
              minSendable: 1000,
              maxSendable: 100_000_000_000,
              metadata: METADATA,
              allowsNostr: true,
              nostrPubkey: SERVER,
            }
          : {
              pr: makeInvoice(
                billMsat ?? Number(parsed.searchParams.get('amount')),
                commitment,
              ),
            }
      return { ok: true, status: 200, async json() { return body } }
    }
  }

  /** Measured on wallet.example: `allowsNostr: true`, a `nostrPubkey`, the `nostr`. */
  it('is payable, and reports itself unverified', async () => {
    const res = await createZapInvoice({
      target: { recipientPubkey: RECIPIENT, amountMsat: 21_000, relays: RELAYS },
      recipient: { lud16: 'alice@getalby.com' },
      signer: sender,
      http: { fetch: uncommitted({}) },
    })
    expect(res.ok).toBe(true)
    if (!res.ok || !res.value.zap) throw new Error('expected a payable zap invoice')
    expect(res.value.verified).toBe(false)
  })

  it('is payable too when the server committed to something else entirely', async () => {
    /* A wrong hash reads as evidence that the server ignored the zap request. */
    const res = await createZapInvoice({
      target: { recipientPubkey: RECIPIENT, amountMsat: 21_000, relays: RELAYS },
      recipient: { lud16: 'alice@getalby.com' },
      signer: sender,
      http: { fetch: uncommitted({ descriptionHash: bytesToHex(sha256(utf8ToBytes('something else'))) }) },
    })
    expect(res.ok).toBe(true)
    if (!res.ok || !res.value.zap) throw new Error('expected a payable zap invoice')
    expect(res.value.verified).toBe(false)
  })

  it('STILL refuses an amount that is not the one the reader approved', async () => {
    // The line that actually protects the money, and it did not move: a server may commit.
    const res = await createZapInvoice({
      target: { recipientPubkey: RECIPIENT, amountMsat: 21_000, relays: RELAYS },
      recipient: { lud16: 'alice@getalby.com' },
      signer: sender,
      http: { fetch: uncommitted({}, 99_000) },
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error.code).toBe('invoice-mismatch')
  })

  it('accepts a server that inlined the zap request as the description', async () => {
    // BOLT-11 allows the description in place of its hash, and it is equally checkable.
    let sent = ''
    const fetchLike: FetchLike = async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/.well-known/lnurlp/alice') {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              tag: 'payRequest',
              callback: 'https://getalby.com/lnurlp/alice/callback',
              minSendable: 1000,
              maxSendable: 100_000_000_000,
              metadata: METADATA,
              allowsNostr: true,
              nostrPubkey: SERVER,
            }
          },
        }
      }
      sent = parsed.searchParams.get('nostr') ?? ''
      return {
        ok: true,
        status: 200,
        async json() {
          return { pr: makeInvoice(Number(parsed.searchParams.get('amount')), { description: sent }) }
        },
      }
    }
    const res = await createZapInvoice({
      target: { recipientPubkey: RECIPIENT, amountMsat: 21_000, relays: RELAYS },
      recipient: { lud16: 'alice@getalby.com' },
      signer: sender,
      http: { fetch: fetchLike },
    })
    expect(res.ok).toBe(true)
    if (!res.ok || !res.value.zap) throw new Error('expected a payable zap invoice')
    expect(res.value.verified).toBe(true)
  })
})

/** SIGNATURE VERIFICATION IS CACHED, AND A CACHE ON A SECURITY CHECK HAS TO EARN. */
describe('cached signature verification', () => {
  const AMOUNT = 21_000_000

  async function fixture(): Promise<{ description: string; bolt11: string }> {
    const zapRequest = await buildZapRequest(
      { recipientPubkey: RECIPIENT, eventId: NOTE_ID, amountMsat: AMOUNT, relays: RELAYS },
      sender,
    )
    const description = JSON.stringify(zapRequest)
    return { description, bolt11: makeInvoice(AMOUNT, { descriptionHash: sha256Hex(description) }) }
  }

  it('gives the same answer the second time, for the same receipt', async () => {
    forgetVerifiedSignatures()
    const { description, bolt11 } = await fixture()
    const receipt = signReceipt(SERVER_KEY, { description, bolt11, eventId: NOTE_ID })
    const first = validateZapReceipt({ receipt, recipientPubkey: RECIPIENT, eventId: NOTE_ID })
    const second = validateZapReceipt({ receipt, recipientPubkey: RECIPIENT, eventId: NOTE_ID })
    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
  })

  it('still rejects a tampered receipt once a good one is cached', async () => {
    forgetVerifiedSignatures()
    const { description, bolt11 } = await fixture()
    const receipt = signReceipt(SERVER_KEY, { description, bolt11, eventId: NOTE_ID })
    expect(validateZapReceipt({ receipt, recipientPubkey: RECIPIENT, eventId: NOTE_ID }).ok).toBe(true)

    // Same author, same shape, one altered tag.
    const forged = tamper(receipt, {
      tags: receipt.tags.map(tag => (tag[0] === 'bolt11' ? ['bolt11', makeInvoice(2_100_000_000, {})] : tag)),
    })
    expect(validateZapReceipt({ receipt: forged, recipientPubkey: RECIPIENT, eventId: NOTE_ID }).ok).toBe(false)

    // And the real one is unharmed: a failure must not poison its neighbour's entry.
    expect(validateZapReceipt({ receipt, recipientPubkey: RECIPIENT, eventId: NOTE_ID }).ok).toBe(true)
  })

  it('still rejects a swapped signature, the cache is keyed on it', async () => {
    forgetVerifiedSignatures()
    const { description, bolt11 } = await fixture()
    const receipt = signReceipt(SERVER_KEY, { description, bolt11, eventId: NOTE_ID })
    expect(validateZapReceipt({ receipt, recipientPubkey: RECIPIENT, eventId: NOTE_ID }).ok).toBe(true)

    const swapped = tamper(receipt, { sig: `${'0'.repeat(64)}${receipt.sig.slice(64)}` })
    expect(validateZapReceipt({ receipt: swapped, recipientPubkey: RECIPIENT, eventId: NOTE_ID }).ok).toBe(false)
  })

  it('does not let one receipt answer for another', async () => {
    forgetVerifiedSignatures()
    const { description, bolt11 } = await fixture()
    const real = signReceipt(SERVER_KEY, { description, bolt11, eventId: NOTE_ID })
    const attacker = signReceipt(ATTACKER_KEY, { description, bolt11, eventId: NOTE_ID })
    expect(real.id).not.toBe(attacker.id)
    // Both are validly SIGNED by their own authors, so both pass the signature check.
    expect(validateZapReceipt({ receipt: real, recipientPubkey: RECIPIENT, eventId: NOTE_ID }).ok).toBe(true)
    const withIssuer = validateZapReceipt({
      receipt: attacker,
      lnurlPubkey: SERVER,
      recipientPubkey: RECIPIENT,
      eventId: NOTE_ID,
    })
    expect(withIssuer.ok).toBe(true)
    if (withIssuer.ok) expect(withIssuer.value.issuerVerified).toBe(false)
  })
})
