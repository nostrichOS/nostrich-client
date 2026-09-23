import { verifyEvent } from 'nostr-tools/pure'

import { isCiphertext } from '../ciphertext'
import { assertHexKey, toPubkey } from '../keys'
import type { EventTemplate, Hex, NostrEvent, Signer } from '../types'
import { withClientTag } from '../client-tag'
import { templateMismatch } from './rewrite'

/** The window.nostr surface, as extensions actually implement. */
export interface Nip07Provider {
  getPublicKey(): Promise<string>
  signEvent(template: EventTemplate): Promise<NostrEvent>
  getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
}

export class Nip07UnavailableError extends Error {
  constructor() {
    super('No NIP-07 extension is available in this browser (window.nostr is undefined).')
    this.name = 'Nip07UnavailableError'
  }
}

/** Thrown when the extension is present but cannot do what was asked. */
export class Nip07MissingCapabilityError extends Error {
  readonly capability: 'nip04' | 'nip44'

  constructor(capability: 'nip04' | 'nip44') {
    super(
      capability === 'nip44'
        ? 'This browser extension does not support NIP-44 encryption, which private messages require. Update it, or sign in with a remote signer instead.'
        : 'This browser extension does not support NIP-04, so older messages in this conversation cannot be read.',
    )
    this.name = 'Nip07MissingCapabilityError'
    this.capability = capability
  }
}

export class Nip07RejectedError extends Error {
  constructor(reason?: string) {
    // The default is the overwhelmingly common case.
    super(
      reason ??
        'The extension did not return a signed event; the approval prompt was most likely dismissed.',
    )
    this.name = 'Nip07RejectedError'
  }
}

function readProvider(): Nip07Provider | undefined {
  // Next.js prerenders this package on the server, where touching `window`.
  if (typeof window === 'undefined') return undefined
  return (window as Window & { nostr?: Nip07Provider }).nostr
}

export function isNip07Available(): boolean {
  return readProvider() !== undefined
}

export function nip07SupportsNip44(): boolean {
  return readProvider()?.nip44 !== undefined
}

function requireProvider(): Nip07Provider {
  const provider = readProvider()
  if (provider === undefined) throw new Nip07UnavailableError()
  return provider
}

function assertSignedEvent(value: unknown): NostrEvent {
  const event = value as Partial<NostrEvent> | null | undefined
  // Several extensions resolve with undefined or {} when the user closes the approval.
  if (
    event == null ||
    typeof event.id !== 'string' ||
    typeof event.sig !== 'string' ||
    typeof event.pubkey !== 'string'
  ) {
    throw new Nip07RejectedError()
  }
  return event as NostrEvent
}

/** Signer backed by a browser extension. */
export class Nip07Signer implements Signer {
  readonly kind = 'nip07' as const

  #pubkey: Hex | undefined
  #pubkeyRequest: Promise<Hex> | undefined

  /** Extensions inject window.nostr after our bundle runs, so ask at call time. */
  static isAvailable(): boolean {
    return isNip07Available()
  }

  static supportsNip44(): boolean {
    return nip07SupportsNip44()
  }

  async getPublicKey(): Promise<Hex> {
    if (this.#pubkey !== undefined) return this.#pubkey

    if (this.#pubkeyRequest === undefined) {
      // Some extensions raise a permission dialog per call.
      const request = this.#fetchPublicKey()
      this.#pubkeyRequest = request
      // A refusal must not be cached.
      request.catch(() => {
        if (this.#pubkeyRequest === request) this.#pubkeyRequest = undefined
      })
    }

    const pubkey = await this.#pubkeyRequest
    this.#pubkey = pubkey
    return pubkey
  }

  async signEvent(original: EventTemplate): Promise<NostrEvent> {
    /* Stamped before anything else looks at it, so the tag is part of what gets signed. */
    const template = withClientTag(original)
    const provider = requireProvider()
    // Extensions have been known to decorate the very object they were handed and return.
    const signed = await provider.signEvent({
      kind: template.kind,
      created_at: template.created_at,
      tags: template.tags.map(tag => [...tag]),
      content: template.content,
    })
    const event = assertSignedEvent(signed)
    /* The extension is asked, not trusted. */
    if (!verifyEvent(event)) {
      throw new Nip07RejectedError('the extension returned an event with an invalid signature')
    }
    const changed = templateMismatch(template, event)
    if (changed !== undefined) {
      throw new Nip07RejectedError(
        `the extension changed the event before signing it: ${changed.detail}`,
      )
    }
    return event
  }

  /** An extension that answers without encrypting must not be able to answer at all. */
  async nip44Encrypt(peerPubkey: Hex, plaintext: string): Promise<string> {
    const nip44 = requireProvider().nip44
    if (nip44 === undefined) throw new Nip07MissingCapabilityError('nip44')
    const ciphertext = await nip44.encrypt(assertHexKey(peerPubkey, 'peer pubkey'), plaintext)
    if (!isCiphertext(ciphertext)) {
      throw new Nip07RejectedError('the extension returned empty ciphertext for nip44 encrypt')
    }
    return ciphertext
  }

  /** The same rule pointing the other way. */
  async nip44Decrypt(peerPubkey: Hex, ciphertext: string): Promise<string> {
    const nip44 = requireProvider().nip44
    if (nip44 === undefined) throw new Nip07MissingCapabilityError('nip44')
    const plaintext = await nip44.decrypt(assertHexKey(peerPubkey, 'peer pubkey'), ciphertext)
    if (typeof plaintext !== 'string' || plaintext === '') {
      throw new Nip07RejectedError('the extension could not decrypt this message')
    }
    return plaintext
  }

  async nip04Decrypt(peerPubkey: Hex, ciphertext: string): Promise<string> {
    const nip04 = requireProvider().nip04
    if (nip04 === undefined) throw new Nip07MissingCapabilityError('nip04')
    const plaintext = await nip04.decrypt(assertHexKey(peerPubkey, 'peer pubkey'), ciphertext)
    if (typeof plaintext !== 'string' || plaintext === '') {
      throw new Nip07RejectedError('the extension could not decrypt this message')
    }
    return plaintext
  }

  async #fetchPublicKey(): Promise<Hex> {
    const provider = requireProvider()
    // Extensions are not consistent about hex vs npub here, and hex is the only form.
    return toPubkey(await provider.getPublicKey())
  }
}
