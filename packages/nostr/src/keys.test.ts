import { inspect } from 'node:util'

import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { verifyEvent } from 'nostr-tools/pure'
import { describe, expect, it } from 'vitest'

import {
  InvalidKeyError,
  decodeNpub,
  decodeNote,
  decodeNsec,
  decodePointer,
  derivePublicKey,
  encodeNaddr,
  encodeNevent,
  encodeNote,
  encodeNprofile,
  encodeNpub,
  encodeNsec,
  generateKeyPair,
  isHexKey,
  normalizeHexKey,
  parseBunkerUri,
  parseKeyInput,
  toEventId,
  toPubkey,
} from './keys'
import { PrivateKeySigner, isNip07Available } from './signers'

// secp256k1's generator point.
const SECRET_ONE = '0000000000000000000000000000000000000000000000000000000000000001'
const PUBKEY_ONE = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

const EVENT_ID = '5c04292b1080052d593c561c62a92f1cfda739cc14e9e8c26765165ee3a29b7d'

describe('key derivation', () => {
  it('derives the generator point from the secret key 1', () => {
    expect(derivePublicKey(hexToBytes(SECRET_ONE))).toBe(PUBKEY_ONE)
  })

  it('generates 32-byte secrets whose pubkey matches the derivation', () => {
    const { secretKey, publicKey } = generateKeyPair()
    expect(secretKey).toHaveLength(32)
    expect(publicKey).toMatch(/^[0-9a-f]{64}$/)
    expect(derivePublicKey(secretKey)).toBe(publicKey)
  })

  it('rejects a secret key of the wrong length', () => {
    expect(() => derivePublicKey(new Uint8Array(31))).toThrow(InvalidKeyError)
  })
})

describe('hex validation', () => {
  it('accepts 64 lowercase hex characters and nothing else', () => {
    expect(isHexKey(PUBKEY_ONE)).toBe(true)
    expect(isHexKey(PUBKEY_ONE.slice(0, 63))).toBe(false)
    expect(isHexKey(PUBKEY_ONE.toUpperCase())).toBe(false)
    expect(isHexKey(42)).toBe(false)
  })

  it('folds the uppercase hex that QR codes and relays hand out', () => {
    expect(normalizeHexKey(` ${PUBKEY_ONE.toUpperCase()} `)).toBe(PUBKEY_ONE)
    expect(normalizeHexKey('nope')).toBeNull()
  })
})

describe('NIP-19 round trips', () => {
  it('round-trips npub', () => {
    const npub = encodeNpub(PUBKEY_ONE)
    expect(npub.startsWith('npub1')).toBe(true)
    expect(decodeNpub(npub)).toBe(PUBKEY_ONE)
    expect(decodePointer(npub)).toEqual({ type: 'npub', pubkey: PUBKEY_ONE })
  })

  it('round-trips nsec without changing the bytes', () => {
    const secretKey = hexToBytes(SECRET_ONE)
    const nsec = encodeNsec(secretKey)
    expect(nsec.startsWith('nsec1')).toBe(true)
    expect(bytesToHex(decodeNsec(nsec))).toBe(SECRET_ONE)
  })

  it('round-trips note, nevent, naddr and nprofile', () => {
    expect(decodeNote(encodeNote(EVENT_ID))).toBe(EVENT_ID)

    const nevent = encodeNevent({
      id: EVENT_ID,
      relays: ['wss://relay-a.example'],
      author: PUBKEY_ONE,
      kind: 1,
    })
    expect(decodePointer(nevent)).toEqual({
      type: 'nevent',
      id: EVENT_ID,
      relays: ['wss://relay-a.example'],
      author: PUBKEY_ONE,
      kind: 1,
    })

    const naddr = encodeNaddr({ kind: 30023, pubkey: PUBKEY_ONE, identifier: 'my-article' })
    expect(decodePointer(naddr)).toEqual({
      type: 'naddr',
      kind: 30023,
      pubkey: PUBKEY_ONE,
      identifier: 'my-article',
      relays: [],
    })

    const nprofile = encodeNprofile({ pubkey: PUBKEY_ONE, relays: ['wss://nos.lol'] })
    expect(decodePointer(nprofile)).toEqual({
      type: 'nprofile',
      pubkey: PUBKEY_ONE,
      relays: ['wss://nos.lol'],
    })
  })

  it('never lets an nsec out through the generic pointer decoder', () => {
    expect(() => decodePointer(encodeNsec(hexToBytes(SECRET_ONE)))).toThrow(InvalidKeyError)
  })

  it('normalises to hex at the edge, including the nostr: prefix', () => {
    expect(toPubkey(PUBKEY_ONE)).toBe(PUBKEY_ONE)
    expect(toPubkey(`nostr:${encodeNpub(PUBKEY_ONE)}`)).toBe(PUBKEY_ONE)
    expect(toPubkey(encodeNprofile({ pubkey: PUBKEY_ONE }))).toBe(PUBKEY_ONE)
    expect(toEventId(encodeNote(EVENT_ID))).toBe(EVENT_ID)
    expect(toEventId(encodeNevent({ id: EVENT_ID }))).toBe(EVENT_ID)
    expect(() => toEventId(encodeNpub(PUBKEY_ONE))).toThrow(InvalidKeyError)
  })
})

describe('parseKeyInput', () => {
  it('recognises an nsec', () => {
    const parsed = parseKeyInput(encodeNsec(hexToBytes(SECRET_ONE)))
    expect(parsed.kind).toBe('privatekey')
    if (parsed.kind !== 'privatekey') throw new Error('unreachable')
    expect(parsed.publicKey).toBe(PUBKEY_ONE)
    expect(bytesToHex(parsed.secretKey)).toBe(SECRET_ONE)
  })

  it('treats bare hex as a secret key, not a pubkey', () => {
    const parsed = parseKeyInput(`  ${SECRET_ONE.toUpperCase()}  `)
    expect(parsed.kind).toBe('privatekey')
    if (parsed.kind !== 'privatekey') throw new Error('unreachable')
    expect(parsed.publicKey).toBe(PUBKEY_ONE)
  })

  it('recognises npub and nprofile as read-only logins', () => {
    expect(parseKeyInput(encodeNpub(PUBKEY_ONE))).toEqual({
      kind: 'pubkey',
      publicKey: PUBKEY_ONE,
      relays: [],
    })
    expect(parseKeyInput(encodeNprofile({ pubkey: PUBKEY_ONE, relays: ['wss://nos.lol'] }))).toEqual(
      { kind: 'pubkey', publicKey: PUBKEY_ONE, relays: ['wss://nos.lol'] },
    )
  })

  it('recognises a bunker URI', () => {
    const parsed = parseKeyInput(
      `bunker://${PUBKEY_ONE}?relay=wss://relay.nsec.app/&relay=wss%3A%2F%2Fnos.lol&secret=abc123`,
    )
    expect(parsed).toEqual({
      kind: 'bunker',
      pointer: {
        remoteSignerPubkey: PUBKEY_ONE,
        relays: ['wss://relay.nsec.app', 'wss://nos.lol'],
        secret: 'abc123',
      },
    })
  })

  it('rejects malformed input without echoing it back', () => {
    for (const bad of [
      '',
      '   ',
      'definitely not a key',
      SECRET_ONE.slice(0, 63),
      `${SECRET_ONE}ff`,
      'npub1notrealbech32',
      'nsec1notrealbech32',
      `bunker://${PUBKEY_ONE}`,
      'bunker://not-a-pubkey?relay=wss://nos.lol',
      '0'.repeat(64),
    ]) {
      expect(() => parseKeyInput(bad), bad).toThrow(InvalidKeyError)
      try {
        parseKeyInput(bad)
      } catch (error) {
        // A rejected paste is often a mistyped nsec.
        if (bad.trim().length > 0) expect((error as Error).message).not.toContain(bad.trim())
      }
    }
  })

  it('rejects a bunker URI with no relay to reach the signer on', () => {
    expect(() => parseBunkerUri(`bunker://${PUBKEY_ONE}?secret=abc`)).toThrow(InvalidKeyError)
  })
})

describe('PrivateKeySigner', () => {
  it('keeps the secret out of every accidental stringification', () => {
    const { secretKey } = generateKeyPair()
    const secretHex = bytesToHex(secretKey)
    const nsec = encodeNsec(secretKey)
    const signer = PrivateKeySigner.fromSecretKey(secretKey)

    const renderings = [
      String(signer),
      `${signer}`,
      signer.toString(),
      JSON.stringify(signer),
      JSON.stringify({ account: { signer } }),
      inspect(signer),
      inspect({ account: { signer } }, { depth: 8 }),
    ]

    for (const rendering of renderings) {
      expect(rendering).toBeTruthy()
      expect(rendering).not.toContain(secretHex)
      expect(rendering).not.toContain(nsec)
      expect(rendering).toContain('redacted')
    }

    // No enumerable field can hold the key, whatever walks the object.
    expect(Object.keys(signer)).toEqual(['kind'])
  })

  it('signs without mutating the caller template', async () => {
    const signer = PrivateKeySigner.fromNsec(encodeNsec(hexToBytes(SECRET_ONE)))
    const template = { kind: 1, created_at: 1_700_000_000, tags: [['t', 'nostrich']], content: 'gm' }
    const before = JSON.stringify(template)

    const event = await signer.signEvent(template)

    expect(JSON.stringify(template)).toBe(before)
    expect(event.pubkey).toBe(PUBKEY_ONE)
    expect(verifyEvent(event)).toBe(true)
  })

  it('round-trips NIP-44 between two signers', async () => {
    const alice = PrivateKeySigner.generate()
    const bob = PrivateKeySigner.generate()

    const ciphertext = await alice.nip44Encrypt(await bob.getPublicKey(), 'meet me at the relay')
    expect(await bob.nip44Decrypt(await alice.getPublicKey(), ciphertext)).toBe(
      'meet me at the relay',
    )
  })

  it('refuses to sign after dispose', async () => {
    const signer = PrivateKeySigner.generate()
    signer.dispose()
    await expect(signer.getPublicKey()).rejects.toThrow(/disposed/)
  })
})

describe('NIP-07 detection', () => {
  it('reports no extension when there is no window at all (SSR / prerender)', () => {
    expect(isNip07Available()).toBe(false)
  })
})
