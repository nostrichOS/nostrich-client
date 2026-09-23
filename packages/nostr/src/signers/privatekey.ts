import { decrypt as decryptNip04 } from 'nostr-tools/nip04'
import {
  decrypt as decryptNip44,
  encrypt as encryptNip44,
  getConversationKey,
} from 'nostr-tools/nip44'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

import { withClientTag } from '../client-tag'
import { InvalidKeyError, assertHexKey, decodeNsec } from '../keys'
import type { EventTemplate, Hex, NostrEvent, Signer } from '../types'

const REDACTED = '[PrivateKeySigner secret redacted]'

// Node's console.log goes through this symbol rather than toString.
const nodeInspect = Symbol.for('nodejs.util.inspect.custom')

export class SignerDisposedError extends Error {
  constructor() {
    super('this PrivateKeySigner was disposed; create a new one from the stored key')
    this.name = 'SignerDisposedError'
  }
}

/** A signer holding the key in memory for the lifetime of a session. */
export class PrivateKeySigner implements Signer {
  readonly kind = 'privatekey' as const

  readonly #secretKey: Uint8Array
  readonly #publicKey: Hex
  readonly #conversationKeys = new Map<Hex, Uint8Array>()
  #disposed = false

  private constructor(secretKey: Uint8Array) {
    // Copy: callers are told to zero their buffer after handing it over, and a shared.
    this.#secretKey = Uint8Array.from(secretKey)
    this.#publicKey = getPublicKey(this.#secretKey)
  }

  /** The one door raw secret bytes go. */
  static fromSecretKey(secretKey: Uint8Array): PrivateKeySigner {
    if (secretKey.length !== 32) {
      throw new InvalidKeyError(`secret key must be 32 bytes, got ${secretKey.length}`)
    }
    return new PrivateKeySigner(secretKey)
  }

  static fromNsec(nsec: string): PrivateKeySigner {
    return new PrivateKeySigner(decodeNsec(nsec))
  }

  static generate(): PrivateKeySigner {
    return new PrivateKeySigner(generateSecretKey())
  }

  async getPublicKey(): Promise<Hex> {
    this.#assertLive()
    return this.#publicKey
  }

  async signEvent(original: EventTemplate): Promise<NostrEvent> {
    this.#assertLive()
    /* Stamped before anything else looks at it, so the tag is part of what gets signed. */
    const template = withClientTag(original)

    // finalizeEvent writes pubkey/id/sig onto the object it is handed.
    return finalizeEvent(
      {
        kind: template.kind,
        created_at: template.created_at,
        tags: template.tags.map(tag => [...tag]),
        content: template.content,
      },
      this.#secretKey,
    )
  }

  async nip44Encrypt(peerPubkey: Hex, plaintext: string): Promise<string> {
    this.#assertLive()
    return encryptNip44(plaintext, this.#conversationKey(peerPubkey))
  }

  async nip44Decrypt(peerPubkey: Hex, ciphertext: string): Promise<string> {
    this.#assertLive()
    return decryptNip44(ciphertext, this.#conversationKey(peerPubkey))
  }

  /** Reading old conversations only. */
  async nip04Decrypt(peerPubkey: Hex, ciphertext: string): Promise<string> {
    this.#assertLive()
    return decryptNip04(this.#secretKey, assertHexKey(peerPubkey, 'peer pubkey'), ciphertext)
  }

  /** Zero the key on logout. */
  dispose(): void {
    this.#secretKey.fill(0)
    for (const key of this.#conversationKeys.values()) key.fill(0)
    this.#conversationKeys.clear()
    this.#disposed = true
  }

  /* A signer ends up in a store, in a React tree, in a crash report. */
  toString(): string {
    return REDACTED
  }

  toJSON(): string {
    return REDACTED
  }

  [nodeInspect](): string {
    return REDACTED
  }

  #conversationKey(peerPubkey: Hex): Uint8Array {
    const peer = assertHexKey(peerPubkey, 'peer pubkey')
    let key = this.#conversationKeys.get(peer)
    if (key === undefined) {
      // One ECDH per peer, not per message: opening a conversation decrypts hundreds.
      key = getConversationKey(this.#secretKey, peer)
      this.#conversationKeys.set(peer, key)
    }
    return key
  }

  #assertLive(): void {
    if (this.#disposed) throw new SignerDisposedError()
  }
}
