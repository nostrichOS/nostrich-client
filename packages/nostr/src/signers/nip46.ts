/** NIP-46: the key lives on another device and answers over a relay. */

import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils'
import { decrypt as decryptNip04 } from 'nostr-tools/nip04'
import {
  decrypt as decryptNip44,
  encrypt as encryptNip44,
  getConversationKey,
} from 'nostr-tools/nip44'
import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'

import { isCiphertext } from '../ciphertext'
import { assertHexKey, parseBunkerUri, parseNostrUri, toPubkey, type BunkerPointer } from '../keys'
import type { EventTemplate, Filter, Hex, NostrEvent, RelayUrl, Signer } from '../types'
import { withClientTag } from '../client-tag'
import { templateMismatch } from './rewrite'

const NOSTR_CONNECT_KIND = 24133

/** 60s, not the 5–10s an HTTP call would get: every request ends with someone picking. */
const DEFAULT_TIMEOUT_MS = 60_000

/** A relay that takes the EVENT but never sends OK must not hold a request open. */
const PUBLISH_GRACE_MS = 10_000

/** How long a goodbye is worth waiting. */
const LOGOUT_GRACE_MS = 3_000

/** How long to wait for EOSE (proof our filter is live) before publishing anyway. */
const SUBSCRIBE_GRACE_MS = 5_000

const RECONNECT_DELAY_MS = 2_000
/** Ceiling for the reconnect backoff. */
const MAX_RECONNECT_DELAY_MS = 30_000

/** Long enough for the user to find their phone, unlock it and scan. */
const DEFAULT_PAIRING_TIMEOUT_MS = 300_000

export class Nip46Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Nip46Error'
  }
}

export class Nip46TimeoutError extends Nip46Error {
  readonly method: string

  constructor(method: string, timeoutMs: number) {
    super(`the remote signer did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`)
    this.name = 'Nip46TimeoutError'
    this.method = method
  }
}

/** The signer answered, and said. */
export class Nip46RemoteError extends Nip46Error {
  readonly method: string
  readonly reason: string

  constructor(method: string, reason: string) {
    super(`the remote signer refused ${method}: ${reason}`)
    this.name = 'Nip46RemoteError'
    this.method = method
    this.reason = reason
  }
}

export interface Nip46SignerOptions {
  /** The signer wants the user to approve in a browser first. */
  onAuthUrl?: (url: string) => void
  /** Per-request budget. Default 60s, restarted once if an auth_url arrives. */
  timeoutMs?: number
  /** Transport keypair. */
  clientSecretKey?: Uint8Array
  /** Requested in `connect`, e.g. ['sign_event:1', 'nip44_decrypt']. */
  perms?: string[]
  /** THE USER'S PUBKEY, WHEN IT IS ALREADY KNOWN. */
  userPubkey?: Hex
  /** Pairing already happened (nostrconnect), so skip `connect` on first use. */
  alreadyPaired?: boolean
  /** Reuse an existing pool instead of opening a second set of sockets. */
  pool?: SimplePool
}

interface PendingRequest {
  method: string
  /** Kept so the request can be ASKED AGAIN, which is the whole point of `wake`. */
  params: string[]
  resolve: (result: string) => void
  reject: (error: Error) => void
  /** Replaced by `sleep`/`wake`, so it is not readonly. */
  timer: ReturnType<typeof setTimeout> | undefined
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function parseSignedEvent(json: string): NostrEvent {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new Nip46Error('the remote signer returned something that is not an event')
  }
  const event = value as Partial<NostrEvent> | null
  if (
    event == null ||
    typeof event.id !== 'string' ||
    typeof event.sig !== 'string' ||
    typeof event.pubkey !== 'string' ||
    !Array.isArray(event.tags)
  ) {
    throw new Nip46Error('the remote signer returned an incomplete event')
  }
  return event as NostrEvent
}

/** Everything needed to resume a pairing without asking the reader to approve again. */
export interface Nip46Credential {
  /** Hex. */
  clientSecretKey: string
  remoteSignerPubkey: Hex
  relays: RelayUrl[]
  /** Granted at `connect` and frozen there, so a resumed signer must ask for the same set. */
  perms: string[]
}

export class Nip46Signer implements Signer {
  readonly kind = 'nip46' as const

  readonly #clientSecretKey: Uint8Array
  readonly #clientPubkey: Hex
  readonly #remoteSignerPubkey: Hex
  readonly #relays: RelayUrl[]
  readonly #secret: string | undefined
  readonly #perms: string[]
  readonly #timeoutMs: number
  readonly #onAuthUrl: ((url: string) => void) | undefined
  readonly #userPubkey: Hex | undefined
  readonly #pool: SimplePool
  readonly #ownsPool: boolean
  readonly #conversationKey: Uint8Array
  readonly #pending = new Map<string, PendingRequest>()

  #paired: boolean
  #sub: { close(): void } | undefined
  #subscribing: Promise<void> | undefined
  #session: Promise<Hex> | undefined
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined
  /** True between `sleep` and `wake`: deadlines are not counted while nobody can answer. */
  #asleep = false
  #reconnectAttempt = 0
  #closed = false

  constructor(pointer: BunkerPointer, options: Nip46SignerOptions = {}) {
    if (pointer.relays.length === 0) {
      throw new Nip46Error('a NIP-46 connection needs at least one relay')
    }
    this.#clientSecretKey =
      options.clientSecretKey === undefined
        ? generateSecretKey()
        : Uint8Array.from(options.clientSecretKey)
    this.#clientPubkey = getPublicKey(this.#clientSecretKey)
    this.#remoteSignerPubkey = assertHexKey(pointer.remoteSignerPubkey, 'remote signer pubkey')
    this.#relays = [...pointer.relays]
    this.#secret = pointer.secret
    this.#perms = options.perms ?? []
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#onAuthUrl = options.onAuthUrl
    this.#userPubkey = options.userPubkey
    this.#pool = options.pool ?? new SimplePool()
    this.#ownsPool = options.pool === undefined
    this.#paired = options.alreadyPaired ?? false
    this.#conversationKey = getConversationKey(this.#clientSecretKey, this.#remoteSignerPubkey)
  }

  static fromBunkerUri(uri: string, options: Nip46SignerOptions = {}): Nip46Signer {
    return new Nip46Signer(parseBunkerUri(uri), options)
  }

  /** The record needed to rebuild this signer later, or `undefined` if there is nothing. */
  toResumable(): Nip46Credential | undefined {
    if (!this.#paired) return undefined
    return {
      clientSecretKey: bytesToHex(this.#clientSecretKey),
      remoteSignerPubkey: this.#remoteSignerPubkey,
      relays: [...this.#relays],
      perms: [...this.#perms],
    }
  }

  /** Rebuild a signer from a stored pairing. */
  static fromResumable(
    credential: Nip46Credential,
    options: Omit<Nip46SignerOptions, 'clientSecretKey' | 'alreadyPaired' | 'perms'> = {},
  ): Nip46Signer {
    let clientSecretKey: Uint8Array
    try {
      clientSecretKey = hexToBytes(credential.clientSecretKey)
    } catch {
      throw new Nip46Error('stored client key is not valid hex')
    }
    if (clientSecretKey.length !== 32) {
      throw new Nip46Error('stored client key is not a 32-byte secret key')
    }
    try {
      return new Nip46Signer(
        { remoteSignerPubkey: credential.remoteSignerPubkey, relays: [...credential.relays] },
        { ...options, clientSecretKey, perms: [...credential.perms], alreadyPaired: true },
      )
    } catch (cause) {
      // 32 bytes of hex is not necessarily a valid secp256k1 scalar, and a stored blob can.
      if (cause instanceof Nip46Error) throw cause
      throw new Nip46Error('stored pairing could not be restored')
    }
  }

  /** Transport pubkey the signer knows this app. */
  get clientPublicKey(): Hex {
    return this.#clientPubkey
  }

  get remoteSignerPublicKey(): Hex {
    return this.#remoteSignerPubkey
  }

  get relays(): readonly RelayUrl[] {
    return this.#relays
  }

  /** Pair, then learn which identity we are signing. */
  async connect(): Promise<Hex> {
    if (this.#closed) throw new Nip46Error('this signer has been closed')
    const existing = this.#session
    if (existing !== undefined) return existing

    const started = this.#openSession()
    this.#session = started
    // A failed pairing must not be cached: the user can fix the bunker and retry.
    started.catch(() => {
      if (this.#session === started) this.#session = undefined
    })
    return started
  }

  async getPublicKey(): Promise<Hex> {
    return this.connect()
  }

  async signEvent(original: EventTemplate): Promise<NostrEvent> {
    /* Stamped before anything else looks at it, so the tag is part of what gets signed. */
    const template = withClientTag(original)
    const userPubkey = await this.connect()
    const result = await this.#request('sign_event', [
      JSON.stringify({
        kind: template.kind,
        created_at: template.created_at,
        tags: template.tags.map(tag => [...tag]),
        content: template.content,
      }),
    ])

    const event = parseSignedEvent(result)
    if (event.pubkey !== userPubkey) {
      // A signer holding several identities can answer with the wrong one, and the whole.
      throw new Nip46Error(
        `the remote signer returned an event signed by ${event.pubkey}, not ${userPubkey}`,
      )
    }
    // Checked here rather than at publish time: relays drop a bad signature silently.
    if (!verifyEvent(event)) {
      throw new Nip46Error('the remote signer returned an event with an invalid signature')
    }
    // A valid signature over the wrong words is still the wrong note.
    const changed = templateMismatch(template, event)
    if (changed !== undefined) {
      throw new Nip46Error(
        `the remote signer changed the event before signing it: ${changed.detail}`,
      )
    }
    return event
  }

  /** NIP-44 ciphertext, and never an empty string. */
  async nip44Encrypt(peerPubkey: Hex, plaintext: string): Promise<string> {
    await this.connect()
    const ciphertext = await this.#request('nip44_encrypt', [
      assertHexKey(peerPubkey, 'peer pubkey'),
      plaintext,
    ])
    if (!isCiphertext(ciphertext)) {
      throw new Nip46Error('the remote signer returned empty ciphertext for nip44_encrypt')
    }
    return ciphertext
  }

  async nip44Decrypt(peerPubkey: Hex, ciphertext: string): Promise<string> {
    await this.connect()
    return this.#request('nip44_decrypt', [assertHexKey(peerPubkey, 'peer pubkey'), ciphertext])
  }

  async nip04Decrypt(peerPubkey: Hex, ciphertext: string): Promise<string> {
    await this.connect()
    return this.#request('nip04_decrypt', [assertHexKey(peerPubkey, 'peer pubkey'), ciphertext])
  }

  /** Round trip that proves the signer is still reachable. */
  async ping(): Promise<string> {
    return this.#request('ping', [])
  }

  /** Idempotent. Pending requests reject rather than hang for another minute. */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = undefined
    this.#sub?.close()
    this.#sub = undefined
    this.#session = undefined
    for (const id of [...this.#pending.keys()]) {
      this.#settle(id, pending =>
        pending.reject(new Nip46Error(`${pending.method} abandoned: the signer connection was closed`)),
      )
    }
    if (this.#ownsPool) this.#pool.close(this.#relays)
  }

/** End the session at the signer, then close. */
  async logout(): Promise<void> {
    if (this.#closed) return
    if (this.#paired) {
      try {
        await Promise.race([
          this.#publish(this.#envelope(bytesToHex(randomBytes(8)), 'logout', [])),
          delay(LOGOUT_GRACE_MS),
        ])
      } catch {
        // Unreachable relays are exactly the case the spec says not to wait.
      }
    }
    this.close()
  }

  async #openSession(): Promise<Hex> {
    if (!this.#paired) {
      await this.#ensureSubscribed()
      const params = [this.#remoteSignerPubkey, this.#secret ?? '']
      if (this.#perms.length > 0) params.push(this.#perms.join(','))
      await this.#request('connect', params)
      this.#paired = true
    }

    /* A pairing restored from disk already knows who the reader. */
    if (this.#userPubkey !== undefined) return this.#userPubkey

    await this.#ensureSubscribed()
    // The bunker's own key is not the user's key.
    return assertHexKey(await this.#request('get_public_key', []), 'pubkey from the remote signer')
  }

  /** One request, as an event. */
  #envelope(id: string, method: string, params: string[]): NostrEvent {
    return finalizeEvent(
      {
        kind: NOSTR_CONNECT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', this.#remoteSignerPubkey]],
        content: encryptNip44(JSON.stringify({ id, method, params }), this.#conversationKey),
      },
      this.#clientSecretKey,
    )
  }

  /** The per-request deadline, as a timer that can be thrown away and rebuilt. */
  #arm(id: string, method: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.#settle(id, pending => pending.reject(new Nip46TimeoutError(method, this.#timeoutMs)))
    }, this.#timeoutMs)
  }

  async #request(method: string, params: string[]): Promise<string> {
    await this.#ensureSubscribed()

    const id = bytesToHex(randomBytes(8))
    const request = this.#envelope(id, method, params)

    const answer = new Promise<string>((resolve, reject) => {
      this.#pending.set(id, {
        method,
        params,
        resolve,
        reject,
        timer: this.#asleep ? undefined : this.#arm(id, method),
      })
    })

    try {
      await this.#publish(request)
    } catch (error) {
      // Nobody is awaiting `answer` on this path.
      answer.catch(() => {})
      this.#settle(id, pending => pending.reject(error as Error))
      throw error
    }

    return answer
  }

  async #publish(event: NostrEvent): Promise<void> {
    const results = await Promise.race([
      Promise.allSettled(this.#pool.publish(this.#relays, event)),
      delay(PUBLISH_GRACE_MS).then(() => undefined),
    ])
    if (results !== undefined && results.every(result => result.status === 'rejected')) {
      throw new Nip46Error(
        `could not reach the remote signer on any of ${this.#relays.join(', ')}`,
      )
    }
  }

  async #ensureSubscribed(): Promise<void> {
    if (this.#closed) throw new Nip46Error('this signer has been closed')
    if (this.#sub !== undefined) return
    const inFlight = this.#subscribing
    if (inFlight !== undefined) return inFlight

    const opening = this.#subscribe()
    this.#subscribing = opening
    try {
      await opening
    } finally {
      this.#subscribing = undefined
    }
  }

  #subscribe(): Promise<void> {
    let markReady: () => void = () => {}
    const ready = new Promise<void>(resolve => {
      markReady = resolve
    })
    const grace = setTimeout(() => markReady(), SUBSCRIBE_GRACE_MS)
    const finish = () => {
      clearTimeout(grace)
      markReady()
    }

    const filter: Filter = {
      kinds: [NOSTR_CONNECT_KIND],
      '#p': [this.#clientPubkey],
      // Clock skew against the signer's phone is routine, and request ids are random enough.
      since: Math.floor(Date.now() / 1000) - 60,
    }

    this.#sub = this.#pool.subscribe(this.#relays, filter, {
      onevent: (event: NostrEvent) => {
        void this.#handleEvent(event)
      },
      // EOSE is the only proof the relay has our filter registered.
      oneose: () => {
        // A relay that answered is a relay worth trusting again quickly.
        this.#reconnectAttempt = 0
        finish()
      },
      onclose: () => {
        finish()
        this.#handleSubscriptionClosed()
      },
    })

    return ready
  }

  #handleSubscriptionClosed(): void {
    this.#sub = undefined
    if (this.#closed || this.#reconnectTimer !== undefined) return
    // Only worth reconnecting for a live session or a request still waiting on an approval.
    if (this.#session === undefined && this.#pending.size === 0) return

    // Equal jitter: half the delay is fixed, half is random.
    const backoff = Math.min(
      MAX_RECONNECT_DELAY_MS,
      RECONNECT_DELAY_MS * 2 ** this.#reconnectAttempt,
    )
    this.#reconnectAttempt += 1
    const delay = backoff / 2 + Math.random() * (backoff / 2)

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      if (this.#closed || this.#sub !== undefined) return
      void this.#ensureSubscribed().catch(() => {})
    }, delay)
  }

  /** The app came back to the foreground. */
  wake(): void {
    if (this.#closed) return
    /* THE TEST IS WHETHER A SUBSCRIPTION IS OPEN, not whether a session. */
    if (this.#sub === undefined && this.#pending.size === 0) return

    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = undefined
    }
    this.#reconnectAttempt = 0
    this.#asleep = false
    this.#sub?.close()
    this.#sub = undefined
    void this.#ensureSubscribed()
      .then(() => this.#resend())
      .catch(() => {})
  }

  /** The app is going away. */
  sleep(): void {
    if (this.#closed || this.#asleep) return
    this.#asleep = true
    for (const pending of this.#pending.values()) {
      if (pending.timer !== undefined) clearTimeout(pending.timer)
      pending.timer = undefined
    }
  }

  /** Ask again for everything still unanswered, and give each one a fresh deadline. */
  async #resend(): Promise<void> {
    for (const [id, pending] of [...this.#pending]) {
      if (pending.timer === undefined) pending.timer = this.#arm(id, pending.method)
      try {
        await this.#publish(this.#envelope(id, pending.method, pending.params))
      } catch {
        // Every relay refused.
      }
    }
  }

  async #handleEvent(event: NostrEvent): Promise<void> {
    if (event.pubkey !== this.#remoteSignerPubkey) return

    const payload = await this.#decryptPayload(event)
    if (payload === undefined) return

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    if (typeof parsed !== 'object' || parsed === null) return

    const { id, result, error } = parsed as { id?: unknown; result?: unknown; error?: unknown }
    if (typeof id !== 'string') return
    const pending = this.#pending.get(id)
    if (pending === undefined) return

    if (result === 'auth_url') {
      // Not an answer.
      if (typeof error === 'string' && error.length > 0) {
        clearTimeout(pending.timer)
        pending.timer = setTimeout(() => {
          this.#pending.delete(id)
          pending.reject(new Nip46TimeoutError(pending.method, this.#timeoutMs))
        }, this.#timeoutMs)
        this.#onAuthUrl?.(error)
      }
      return
    }

    if (typeof error === 'string' && error.length > 0) {
      this.#settle(id, request => request.reject(new Nip46RemoteError(request.method, error)))
      return
    }
    if (typeof result !== 'string') {
      this.#settle(id, request =>
        request.reject(new Nip46Error(`the remote signer answered ${request.method} with no result`)),
      )
      return
    }
    this.#settle(id, request => request.resolve(result))
  }

  async #decryptPayload(event: NostrEvent): Promise<string | undefined> {
    try {
      return decryptNip44(event.content, this.#conversationKey)
    } catch {
      // Bunkers written before NIP-46 moved to NIP-44 still answer with NIP-04.
      try {
        return await decryptNip04(this.#clientSecretKey, event.pubkey, event.content)
      } catch {
        return undefined
      }
    }
  }

  #settle(id: string, apply: (pending: PendingRequest) => void): void {
    const pending = this.#pending.get(id)
    if (pending === undefined) return
    this.#pending.delete(id)
    clearTimeout(pending.timer)
    apply(pending)
  }
}

// ---------------------------------------------------------------------------.

export interface NostrConnectPointer {
  /** The client's transport pubkey. */
  clientPubkey: Hex
  relays: RelayUrl[]
  secret: string
  perms: string[]
  name?: string
  url?: string
  image?: string
}

export function parseNostrConnectUri(uri: string): NostrConnectPointer {
  const { authority, params, relays } = parseNostrUri(uri, 'nostrconnect')
  const value = (key: string): string | undefined => params.find(([k]) => k === key)?.[1]
  const secret = value('secret')
  if (secret === undefined || secret.length === 0) {
    throw new Nip46Error('nostrconnect URI has no secret=; the signer could not prove it read it')
  }
  if (relays.length === 0) {
    throw new Nip46Error('nostrconnect URI has no usable relay=')
  }
  const perms = value('perms')
  return {
    clientPubkey: toPubkey(authority),
    relays,
    secret,
    perms: perms === undefined || perms.length === 0 ? [] : perms.split(','),
    name: value('name'),
    url: value('url'),
    image: value('image'),
  }
}

export interface NostrConnectOptions extends Nip46SignerOptions {
  /** Where the invite listens. The signer only ever sees. */
  relays: RelayUrl[]
  /** How long the QR code stays valid. */
  pairingTimeoutMs?: number
  /** REBUILD AN INVITE THAT IS ALREADY OUT THERE, rather than minting a fresh one. */
  resume?: {
    clientSecretKey: string
    secret: string
    since: number
  }
  /** Shown in the signer's approval prompt. */
  name?: string
  url?: string
  image?: string
}

export interface NostrConnectInvite {
  /** Render as a QR code and as a deep link. */
  uri: string
  clientPublicKey: Hex
  secret: string
  /** The transport key this invite listens on, as hex, so the caller can WRITE IT DOWN. */
  clientSecretKey: string
  /** Unix seconds, to pass back as `resume.since`. */
  createdAt: number
  /** Same promise on every call: resolves once a signer answers, rejects on timeout. */
  waitForSigner(): Promise<Nip46Signer>
  /** Stop listening. Safe after the promise settled. */
  cancel(): void
}

/** Build the invite the user scans, and wait for a signer to claim. */
/** The stored transport key, or undefined when there is nothing to resume. */
function resumeKey(resume: NostrConnectOptions['resume']): Uint8Array | undefined {
  if (resume === undefined || resume.secret === '') return undefined
  try {
    const bytes = hexToBytes(resume.clientSecretKey)
    if (bytes.length !== 32) return undefined
    getPublicKey(bytes)
    return bytes
  } catch {
    return undefined
  }
}

export function createNostrConnectInvite(options: NostrConnectOptions): NostrConnectInvite {
  if (options.relays.length === 0) {
    throw new Nip46Error('a nostrconnect invite needs at least one relay')
  }

  const relays = [...options.relays]
  const resumed = resumeKey(options.resume)
  const clientSecretKey =
    resumed ??
    (options.clientSecretKey === undefined
      ? generateSecretKey()
      : Uint8Array.from(options.clientSecretKey))
  const clientPubkey = getPublicKey(clientSecretKey)
  const secret = resumed === undefined ? bytesToHex(randomBytes(16)) : (options.resume as { secret: string }).secret
  // The invite's own age, so a resumed one asks the relays far enough back to be handed.
  const since =
    resumed === undefined
      ? Math.floor(Date.now() / 1000) - 60
      : (options.resume as { since: number }).since
  const pool = options.pool ?? new SimplePool()
  const ownsPool = options.pool === undefined
  const pairingTimeoutMs = options.pairingTimeoutMs ?? DEFAULT_PAIRING_TIMEOUT_MS

  const query = relays.map(relay => `relay=${encodeURIComponent(relay)}`)
  query.push(`secret=${encodeURIComponent(secret)}`)
  if (options.perms !== undefined && options.perms.length > 0) {
    query.push(`perms=${encodeURIComponent(options.perms.join(','))}`)
  }
  if (options.name !== undefined) query.push(`name=${encodeURIComponent(options.name)}`)
  if (options.url !== undefined) query.push(`url=${encodeURIComponent(options.url)}`)
  if (options.image !== undefined) query.push(`image=${encodeURIComponent(options.image)}`)
  const uri = `nostrconnect://${clientPubkey}?${query.join('&')}`

  let sub: { close(): void } | undefined
  let settled = false
  let cancel = (): void => {}

  const waiting = new Promise<Nip46Signer>((resolve, reject) => {
    const cleanup = (): void => {
      sub?.close()
      sub = undefined
      // The signer opens its own connection so its lifetime is not tied to the QR screen.
      if (ownsPool) pool.close(relays)
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Nip46TimeoutError('nostrconnect', pairingTimeoutMs))
    }, pairingTimeoutMs)

    cancel = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      reject(new Nip46Error('pairing cancelled'))
    }

    const handle = async (event: NostrEvent): Promise<void> => {
      if (settled) return
      const conversationKey = getConversationKey(clientSecretKey, event.pubkey)

      let payload: string
      try {
        payload = decryptNip44(event.content, conversationKey)
      } catch {
        try {
          payload = await decryptNip04(clientSecretKey, event.pubkey, event.content)
        } catch {
          return
        }
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        return
      }
      if (typeof parsed !== 'object' || parsed === null) return
      const message = parsed as {
        result?: unknown
        error?: unknown
        method?: unknown
        params?: unknown
      }

      if (message.result === 'auth_url') {
        if (typeof message.error === 'string' && message.error.length > 0) {
          options.onAuthUrl?.(message.error)
        }
        return
      }

      // The signer proves it read our URI by echoing the secret.
      const echoed =
        message.result === secret ||
        (message.method === 'connect' &&
          Array.isArray(message.params) &&
          message.params.includes(secret))
      if (!echoed) return

      settled = true
      clearTimeout(timer)
      cleanup()
      resolve(
        new Nip46Signer(
          { remoteSignerPubkey: event.pubkey, relays },
          {
            clientSecretKey,
            timeoutMs: options.timeoutMs,
            onAuthUrl: options.onAuthUrl,
            perms: options.perms,
            pool: options.pool,
            alreadyPaired: true,
          },
        ),
      )
    }

    sub = pool.subscribe(
      relays,
      {
        kinds: [NOSTR_CONNECT_KIND],
        '#p': [clientPubkey],
        since,
      },
      {
        onevent: (event: NostrEvent) => {
          void handle(event)
        },
      },
    )
  })

  // Nothing may await this until waitForSigner() is called, and a cancelled or timed.
  waiting.catch(() => {})

  return {
    uri,
    clientPublicKey: clientPubkey,
    secret,
    clientSecretKey: bytesToHex(clientSecretKey),
    createdAt: since,
    waitForSigner: () => waiting,
    cancel: () => cancel(),
  }
}
