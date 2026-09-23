/** NIP-47 Nostr Wallet Connect. */

import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import * as nip04 from 'nostr-tools/nip04'
import * as nip44 from 'nostr-tools/nip44'
import { NWCWalletRequest as KIND_NWC_REQUEST, NWCWalletResponse as KIND_NWC_RESPONSE } from 'nostr-tools/kinds'

/** The wallet's own advertisement: kind 13194, published by the wallet service. */
const KIND_NWC_INFO = 13194
import { hexToBytes } from '@noble/hashes/utils'
import type {
  EventTemplate,
  Hex,
  NostrEvent,
  Pool,
  RelayUrl,
  Signer,
  SubscriptionHandle,
  WalletConnection,
} from './types'

// --------------------------------------------------------------------------- Results.

export type NwcErrorCode =
  // Reported by the wallet itself (NIP-47 error codes).
  | 'RATE_LIMITED'
  | 'NOT_IMPLEMENTED'
  | 'INSUFFICIENT_BALANCE'
  | 'QUOTA_EXCEEDED'
  | 'RESTRICTED'
  | 'UNAUTHORIZED'
  | 'INTERNAL'
  | 'PAYMENT_FAILED'
  | 'NOT_FOUND'
  | 'UNSUPPORTED_ENCRYPTION'
  | 'OTHER'
  // Raised on our side of the wire.
  | 'INVALID_URI'
  | 'RELAY_UNREACHABLE'
  | 'TIMEOUT'
  | 'DECRYPT_FAILED'
  | 'MALFORMED_RESPONSE'

export interface NwcError {
  code: NwcErrorCode
  message: string
  /** True when the wallet answered and said. */
  fromWallet: boolean
}

export type NwcResult<T> = { ok: true; value: T } | { ok: false; error: NwcError }

const WALLET_ERROR_CODES = new Set<string>([
  'RATE_LIMITED',
  'NOT_IMPLEMENTED',
  'INSUFFICIENT_BALANCE',
  'QUOTA_EXCEEDED',
  'RESTRICTED',
  'UNAUTHORIZED',
  'INTERNAL',
  'PAYMENT_FAILED',
  'NOT_FOUND',
  'UNSUPPORTED_ENCRYPTION',
  'OTHER',
])

function localError(code: NwcErrorCode, message: string): { ok: false; error: NwcError } {
  return { ok: false, error: { code, message, fromWallet: false } }
}

function walletError(rawCode: unknown, rawMessage: unknown): { ok: false; error: NwcError } {
  const code = typeof rawCode === 'string' && WALLET_ERROR_CODES.has(rawCode) ? (rawCode as NwcErrorCode) : 'OTHER'
  const message = typeof rawMessage === 'string' && rawMessage.length > 0 ? rawMessage : `wallet returned ${code}`
  return { ok: false, error: { code, message, fromWallet: true } }
}

// ---------------------------------------------------------------------------.

const HEX64 = /^[0-9a-f]{64}$/i

/** Parse `nostr+walletconnect://<pubkey>?relay=...&secret=...&lud16=...`. */
export function parseWalletConnectUri(uri: string): NwcResult<WalletConnection> {
  const trimmed = uri.trim()
  const withoutScheme = trimmed.replace(/^nostr\+?walletconnect:(\/\/)?/i, '')
  if (withoutScheme === trimmed) {
    return localError('INVALID_URI', 'not a nostr+walletconnect: URI')
  }

  const queryStart = withoutScheme.indexOf('?')
  const walletPubkey = (queryStart === -1 ? withoutScheme : withoutScheme.slice(0, queryStart))
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
  if (!HEX64.test(walletPubkey)) {
    return localError('INVALID_URI', 'wallet pubkey is not 64-char hex')
  }

  const params = new URLSearchParams(queryStart === -1 ? '' : withoutScheme.slice(queryStart + 1))

  const relay = params.get('relay')
  if (!relay || !/^wss?:\/\//i.test(relay)) {
    return localError('INVALID_URI', 'connection URI has no ws(s) relay')
  }

  const secret = params.get('secret')?.toLowerCase()
  if (!secret || !HEX64.test(secret)) {
    return localError('INVALID_URI', 'connection URI has no 64-char hex secret')
  }

  const connection: WalletConnection = { walletPubkey, relay: normalizeRelay(relay), secret }
  const lud16 = params.get('lud16')
  if (lud16) connection.lud16 = lud16
  return { ok: true, value: connection }
}

/** Every relay in the URI. */
export function walletConnectRelays(uri: string): RelayUrl[] {
  const queryStart = uri.indexOf('?')
  if (queryStart === -1) return []
  const params = new URLSearchParams(uri.slice(queryStart + 1))
  return [...new Set(params.getAll('relay').filter((r) => /^wss?:\/\//i.test(r)).map(normalizeRelay))]
}

function normalizeRelay(url: string): RelayUrl {
  return url.trim().replace(/\/+$/, '')
}

// --------------------------------------------------------------------------- Method.

export type NwcMethod =
  | 'pay_invoice'
  | 'get_balance'
  | 'get_budget'
  | 'get_info'
  | 'list_transactions'
  | 'make_invoice'

export interface NwcPayment {
  preimage: string
  feesPaidMsat?: number
}

export interface NwcBalance {
  balanceMsat: number
}

/** The spending allowance on THIS connection, which is not the wallet's balance. */
export interface NwcBudget {
  usedMsat: number
  totalMsat: number
  /** Unix seconds when the allowance resets, when the wallet says. */
  renewsAt?: number
}

export interface NwcInfo {
  alias?: string
  color?: string
  /** The node's lightning pubkey, unrelated to the wallet service's nostr pubkey. */
  pubkey?: string
  network?: string
  blockHeight?: number
  blockHash?: string
  /** Methods this connection is actually allowed to call. */
  methods: string[]
  notifications: string[]
}

export interface NwcTransaction {
  type: 'incoming' | 'outgoing'
  amountMsat: number
  feesPaidMsat: number
  invoice?: string
  description?: string
  descriptionHash?: string
  preimage?: string
  paymentHash?: string
  createdAt?: number
  expiresAt?: number
  settledAt?: number
  metadata?: Record<string, unknown>
}

export interface PayInvoiceParams {
  invoice: string
  /** Only for amountless invoices. */
  amountMsat?: number
  /** WHAT THIS PAYMENT WAS, for the wallet's own history. */
  metadata?: Record<string, unknown>
}

export interface ListTransactionsParams {
  from?: number
  until?: number
  limit?: number
  offset?: number
  unpaid?: boolean
  type?: 'incoming' | 'outgoing'
}

export interface MakeInvoiceParams {
  amountMsat: number
  description?: string
  descriptionHash?: string
  expirySeconds?: number
}

// --------------------------------------------------------------------------- Client.

export interface NwcClientOptions {
  connection: WalletConnection
  pool: Pool
  /** Overrides the single relay in the connection, e.g. */
  relays?: RelayUrl[]
  /** How long to wait for a kind-23195 before giving up. */
  timeoutMs?: number
  /** Force an encryption instead of asking the wallet which it speaks. */
  encryption?: 'nip44_v2' | 'nip04'
}

export interface NwcClient {
  readonly walletPubkey: Hex
  /** Pubkey derived from the connection secret. */
  readonly clientPubkey: Hex
  payInvoice(params: PayInvoiceParams): Promise<NwcResult<NwcPayment>>
  getBalance(): Promise<NwcResult<NwcBalance>>
  /** Optional in NIP-47. */
  getBudget(): Promise<NwcResult<NwcBudget>>
  getInfo(): Promise<NwcResult<NwcInfo>>
  /** The commands the wallet's kind-13194 advertises, or `undefined` if it publishes none. */
  advertisedMethods(): Promise<readonly string[] | undefined>
  listTransactions(params?: ListTransactionsParams): Promise<NwcResult<NwcTransaction[]>>
  makeInvoice(params: MakeInvoiceParams): Promise<NwcResult<NwcTransaction>>
  /** Escape hatch for methods this client does not model yet. */
  request(method: string, params: Record<string, unknown>): Promise<NwcResult<unknown>>
}

const DEFAULT_TIMEOUT_MS = 30_000

/** NIP-47: metadata longer than this MUST be dropped by the wallet, so it is dropped. */
const NWC_METADATA_MAX = 4096
/** Wallets stamp their own clock. */
const CLOCK_SKEW_SECONDS = 300

type Encryption = 'nip44_v2' | 'nip04'

/** WHICH ENCRYPTION THE WALLET SPEAKS, and why this cannot be assumed. */
async function readWalletInfo(
  pool: Pool,
  walletPubkey: Hex,
  relays: RelayUrl[],
  timeoutMs: number,
): Promise<{ encryption: Encryption; methods: readonly string[] } | undefined> {
  const events = await pool.query(
    [{ kinds: [KIND_NWC_INFO], authors: [walletPubkey], limit: 1 }],
    relays,
    Math.min(timeoutMs, 8_000),
  )
  const info = events[0]
  if (info === undefined) return undefined

  /* The CONTENT is the wallet's list of supported commands, space-separated (NIP-47). */
  const methods = info.content.split(/\s+/u).filter(m => m !== '')

  for (const tag of info.tags) {
    if (tag[0] !== 'encryption') continue
    // The value is a space-separated list, newest first by convention.
    const schemes = (tag[1] ?? '').split(/\s+/u)
    if (schemes.includes('nip44_v2')) return { encryption: 'nip44_v2', methods }
    if (schemes.includes('nip04')) return { encryption: 'nip04', methods }
  }
  // An info event with no `encryption` tag is a wallet from before the tag existed.
  return { encryption: 'nip04', methods }
}

/** Throws only for a connection that could never work (bad hex secret). */
export function createNwcClient(options: NwcClientOptions): NwcClient {
  const { connection, pool } = options
  if (!HEX64.test(connection.walletPubkey)) {
    throw new TypeError('wallet pubkey must be 64-char hex')
  }
  if (!HEX64.test(connection.secret)) {
    throw new TypeError('NWC secret must be 64-char hex; parse the URI with parseWalletConnectUri')
  }

  const walletPubkey = connection.walletPubkey.toLowerCase()
  const { signer, pubkey: clientPubkey } = connectionSigner(connection)
  const relays = options.relays?.length ? options.relays : [connection.relay]
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  /** The wallet's encryption, resolved once and remembered. */
  let scheme: Encryption | undefined = options.encryption
  let advertised: readonly string[] | undefined
  let negotiating:
    | Promise<{ encryption: Encryption; methods: readonly string[] } | undefined>
    | undefined

  function infoOnce() {
    negotiating ??= readWalletInfo(pool, walletPubkey, relays, timeoutMs).then(found => {
      if (found !== undefined) {
        scheme ??= found.encryption
        advertised = found.methods
      }
      negotiating = undefined
      return found
    })
    return negotiating
  }

  async function encryptionFor(): Promise<Encryption> {
    if (scheme !== undefined) return scheme
    const found = await infoOnce()
    // No info event at all: try the modern one first, and `call` retries with the other.
    return found?.encryption ?? 'nip44_v2'
  }

  async function encrypt(using: Encryption, plaintext: string): Promise<string> {
    return using === 'nip04'
      ? signer.nip04Encrypt(walletPubkey, plaintext)
      : signer.nip44Encrypt(walletPubkey, plaintext)
  }

  async function decrypt(using: Encryption, ciphertext: string): Promise<string> {
    /* The scheme is recognisable from the payload, so a wallet that answers in the other. */
    const looksNip04 = ciphertext.includes('?iv=')
    const first = looksNip04 ? 'nip04' : using
    try {
      return first === 'nip04'
        ? await signer.nip04Decrypt(walletPubkey, ciphertext)
        : await signer.nip44Decrypt(walletPubkey, ciphertext)
    } catch (e) {
      const other = first === 'nip04' ? 'nip44_v2' : 'nip04'
      try {
        return other === 'nip04'
          ? await signer.nip04Decrypt(walletPubkey, ciphertext)
          : await signer.nip44Decrypt(walletPubkey, ciphertext)
      } catch {
        throw e
      }
    }
  }

  async function callWith(
    method: string,
    params: Record<string, unknown>,
    using: Encryption,
  ): Promise<NwcResult<unknown>> {
    const nowSeconds = Math.floor(Date.now() / 1000)

    let content: string
    let event: NostrEvent
    try {
      content = await encrypt(using, JSON.stringify({ method, params }))
      const template: EventTemplate = {
        kind: KIND_NWC_REQUEST,
        created_at: nowSeconds,
        tags: [
          ['p', walletPubkey],
          // Only when it is true.
          ...(using === 'nip44_v2' ? [['encryption', 'nip44_v2']] : []),
          // NIP-40, so a relay drops a payment request the wallet was offline for rather.
          ['expiration', String(nowSeconds + Math.ceil(timeoutMs / 1000) + 60)],
        ],
        content,
      }
      event = await signer.signEvent(template)
    } catch (e) {
      return localError('INTERNAL', `could not build request: ${errorText(e)}`)
    }

    return new Promise<NwcResult<unknown>>((resolve) => {
      let handle: SubscriptionHandle | null = null
      let settled = false

      const finish = (result: NwcResult<unknown>): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        handle?.close()
        resolve(result)
      }

      const timer = setTimeout(
        () => finish(localError('TIMEOUT', `wallet did not answer ${method} within ${timeoutMs}ms`)),
        timeoutMs,
      )

      const onEvent = (response: NostrEvent): void => {
        if (settled) return
        // The #e filter is a request to the relay, not a guarantee from it: re-check.
        if (response.pubkey !== walletPubkey) return
        if (!response.tags.some((tag) => tag[0] === 'e' && tag[1] === event.id)) return
        if (!safeVerify(response)) return

        void decrypt(using, response.content)
          .then((plaintext) => finish(readResponse(method, plaintext)))
          .catch((e) => finish(localError('DECRYPT_FAILED', `could not decrypt response: ${errorText(e)}`)))
      }

      // Filtered on the e-tag alone: the request id already identifies exactly one.
      handle = pool.subscribe({
        filters: [
          {
            kinds: [KIND_NWC_RESPONSE],
            authors: [walletPubkey],
            '#e': [event.id],
            since: nowSeconds - CLOCK_SKEW_SECONDS,
          },
        ],
        relays,
        onEvent,
      })
      // The subscription must exist before the request goes out, or a fast wallet answers.
      if (settled) handle.close()

      void pool
        .publish(event, relays)
        .then((results) => {
          if (results.length > 0 && results.every((r) => !r.ok)) {
            const reasons = results.map((r) => `${r.relay}: ${r.message ?? 'rejected'}`).join('; ')
            finish(localError('RELAY_UNREACHABLE', `no relay accepted the request (${reasons})`))
          }
        })
        .catch((e) => finish(localError('RELAY_UNREACHABLE', `publish failed: ${errorText(e)}`)))
    })
  }

  /** One call, with a second attempt in the other encryption if the first is met. */
  const SPENDS = new Set(['pay_invoice', 'pay_keysend', 'multi_pay_invoice', 'multi_pay_keysend'])

  /** SETTLE THE ENCRYPTION WITH A HARMLESS CALL, so a payment never has to guess. */
  async function settleEncryption(): Promise<void> {
    if (scheme !== undefined) return
    const guess = await encryptionFor()
    // The negotiation may have found an info event while we waited, which settles.
    if (scheme !== undefined) return

    const probe = await callWith('get_info', {}, guess)
    if (probe.ok || probe.error.fromWallet) {
      scheme = guess
      return
    }
    if (probe.error.code !== 'TIMEOUT') return

    const other: Encryption = guess === 'nip04' ? 'nip44_v2' : 'nip04'
    const second = await callWith('get_info', {}, other)
    if (second.ok || second.error.fromWallet) scheme = other
  }

  async function call(method: string, params: Record<string, unknown>): Promise<NwcResult<unknown>> {
    if (SPENDS.has(method)) await settleEncryption()
    const using = await encryptionFor()
    // Read BEFORE the call: a concurrent request may pin it while this one is in flight.
    const guessed = scheme === undefined
    const first = await callWith(method, params, using)
    if (first.ok || first.error.code !== 'TIMEOUT') return first
    if (!guessed || SPENDS.has(method)) return first

    const other: Encryption = using === 'nip04' ? 'nip44_v2' : 'nip04'
    const second = await callWith(method, params, other)
    if (second.ok) scheme = other
    return second
  }

  return {
    walletPubkey,
    clientPubkey,

    request: call,

    async payInvoice(params) {
      const request: Record<string, unknown> = { invoice: params.invoice.trim().replace(/^lightning:/i, '') }
      if (params.amountMsat !== undefined) request['amount'] = params.amountMsat
      if (params.metadata !== undefined) {
        // Serialised once to measure it: the cap is on what the wallet stores.
        const encoded = JSON.stringify(params.metadata)
        if (encoded.length <= NWC_METADATA_MAX) request['metadata'] = params.metadata
      }
      const res = await call('pay_invoice', request)
      if (!res.ok) return res
      const result = asRecord(res.value)
      const preimage = result?.['preimage']
      if (typeof preimage !== 'string') {
        return localError('MALFORMED_RESPONSE', 'pay_invoice result has no preimage')
      }
      const payment: NwcPayment = { preimage }
      const fees = result?.['fees_paid']
      if (typeof fees === 'number') payment.feesPaidMsat = fees
      return { ok: true, value: payment }
    },

    async getBalance() {
      const res = await call('get_balance', {})
      if (!res.ok) return res
      const balance = asRecord(res.value)?.['balance']
      if (typeof balance !== 'number') {
        return localError('MALFORMED_RESPONSE', 'get_balance result has no numeric balance')
      }
      return { ok: true, value: { balanceMsat: balance } }
    },

    async advertisedMethods() {
      if (advertised !== undefined) return advertised
      await infoOnce()
      return advertised
    },

    async getBudget() {
      const res = await call('get_budget', {})
      if (!res.ok) return res
      const result = asRecord(res.value)
      if (!result) return localError('MALFORMED_RESPONSE', 'get_budget returned no object')
      /* An empty object is the documented answer for "this connection has no budget". */
      const total = result['total_budget']
      const used = result['used_budget']
      const budget: NwcBudget = {
        usedMsat: typeof used === 'number' ? used : 0,
        totalMsat: typeof total === 'number' ? total : 0,
      }
      if (typeof result['renews_at'] === 'number') budget.renewsAt = result['renews_at']
      return { ok: true as const, value: budget }
    },

    async getInfo() {
      const res = await call('get_info', {})
      if (!res.ok) return res
      const result = asRecord(res.value)
      if (!result) return localError('MALFORMED_RESPONSE', 'get_info returned no object')
      const info: NwcInfo = {
        methods: asStringArray(result['methods']),
        notifications: asStringArray(result['notifications']),
      }
      if (typeof result['alias'] === 'string') info.alias = result['alias']
      if (typeof result['color'] === 'string') info.color = result['color']
      if (typeof result['pubkey'] === 'string') info.pubkey = result['pubkey']
      if (typeof result['network'] === 'string') info.network = result['network']
      if (typeof result['block_height'] === 'number') info.blockHeight = result['block_height']
      if (typeof result['block_hash'] === 'string') info.blockHash = result['block_hash']
      return { ok: true, value: info }
    },

    async listTransactions(params = {}) {
      const request: Record<string, unknown> = {}
      if (params.from !== undefined) request['from'] = params.from
      if (params.until !== undefined) request['until'] = params.until
      if (params.limit !== undefined) request['limit'] = params.limit
      if (params.offset !== undefined) request['offset'] = params.offset
      if (params.unpaid !== undefined) request['unpaid'] = params.unpaid
      if (params.type !== undefined) request['type'] = params.type

      const res = await call('list_transactions', request)
      if (!res.ok) return res
      const raw = asRecord(res.value)?.['transactions']
      if (!Array.isArray(raw)) {
        return localError('MALFORMED_RESPONSE', 'list_transactions result has no transactions array')
      }
      // One unparseable row should cost that row, not the whole history screen.
      const transactions: NwcTransaction[] = []
      for (const entry of raw) {
        const parsed = readTransaction(entry)
        if (parsed) transactions.push(parsed)
      }
      return { ok: true, value: transactions }
    },

    async makeInvoice(params) {
      const request: Record<string, unknown> = { amount: params.amountMsat }
      if (params.description !== undefined) request['description'] = params.description
      if (params.descriptionHash !== undefined) request['description_hash'] = params.descriptionHash
      if (params.expirySeconds !== undefined) request['expiry'] = params.expirySeconds

      const res = await call('make_invoice', request)
      if (!res.ok) return res
      const transaction = readTransaction(res.value)
      if (!transaction || !transaction.invoice) {
        return localError('MALFORMED_RESPONSE', 'make_invoice result has no invoice')
      }
      return { ok: true, value: transaction }
    },
  }
}

// --------------------------------------------------------------------------- Wire.

function readResponse(method: string, plaintext: string): NwcResult<unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(plaintext)
  } catch {
    return localError('MALFORMED_RESPONSE', 'wallet response was not JSON')
  }
  const body = asRecord(parsed)
  if (!body) return localError('MALFORMED_RESPONSE', 'wallet response was not an object')

  const error = asRecord(body['error'])
  if (error) return walletError(error['code'], error['message'])

  const resultType = body['result_type']
  if (typeof resultType === 'string' && resultType !== method) {
    return localError('MALFORMED_RESPONSE', `asked for ${method}, wallet answered ${resultType}`)
  }
  if (body['result'] === undefined || body['result'] === null) {
    return localError('MALFORMED_RESPONSE', `wallet returned neither result nor error for ${method}`)
  }
  return { ok: true, value: body['result'] }
}

function readTransaction(value: unknown): NwcTransaction | null {
  const raw = asRecord(value)
  if (!raw) return null
  const type = raw['type']
  const amount = raw['amount']
  if ((type !== 'incoming' && type !== 'outgoing') || typeof amount !== 'number') return null

  const transaction: NwcTransaction = {
    type,
    amountMsat: amount,
    feesPaidMsat: typeof raw['fees_paid'] === 'number' ? raw['fees_paid'] : 0,
  }
  if (typeof raw['invoice'] === 'string') transaction.invoice = raw['invoice']
  if (typeof raw['description'] === 'string') transaction.description = raw['description']
  if (typeof raw['description_hash'] === 'string') transaction.descriptionHash = raw['description_hash']
  if (typeof raw['preimage'] === 'string') transaction.preimage = raw['preimage']
  if (typeof raw['payment_hash'] === 'string') transaction.paymentHash = raw['payment_hash']
  if (typeof raw['created_at'] === 'number') transaction.createdAt = raw['created_at']
  if (typeof raw['expires_at'] === 'number') transaction.expiresAt = raw['expires_at']
  if (typeof raw['settled_at'] === 'number') transaction.settledAt = raw['settled_at']
  const metadata = asRecord(raw['metadata'])
  if (metadata) transaction.metadata = metadata
  return transaction
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function safeVerify(event: NostrEvent): boolean {
  try {
    return verifyEvent(event)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------.

/** The NWC secret is a wallet-scoped, revocable key that the wallet issued. */
/** The signer NWC uses, which is a `Signer` plus the two NIP-04 methods. */
type NwcSigner = Signer & {
  nip04Encrypt(peerPubkey: Hex, plaintext: string): Promise<string>
  nip04Decrypt(peerPubkey: Hex, ciphertext: string): Promise<string>
}

function connectionSigner(connection: WalletConnection): { signer: NwcSigner; pubkey: Hex } {
  const secretKey = hexToBytes(connection.secret)
  const pubkey = getPublicKey(secretKey)
  // One ECDH per conversation, not per request: a wallet screen fires get_balance.
  const conversationKeys = new Map<Hex, Uint8Array>()

  const conversationKey = (peer: Hex): Uint8Array => {
    let key = conversationKeys.get(peer)
    if (!key) {
      key = nip44.v2.utils.getConversationKey(secretKey, peer)
      conversationKeys.set(peer, key)
    }
    return key
  }

  const signer: NwcSigner = {
    kind: 'privatekey',
    async getPublicKey() {
      return pubkey
    },
    async signEvent(template) {
      // finalizeEvent writes id/pubkey/sig onto the object it is handed.
      return finalizeEvent(
        {
          kind: template.kind,
          created_at: template.created_at,
          tags: template.tags.map((tag) => [...tag]),
          content: template.content,
        },
        secretKey,
      )
    },
    async nip44Encrypt(peerPubkey, plaintext) {
      return nip44.v2.encrypt(plaintext, conversationKey(peerPubkey))
    },
    async nip44Decrypt(peerPubkey, ciphertext) {
      return nip44.v2.decrypt(ciphertext, conversationKey(peerPubkey))
    },
    /** NIP-04, for the wallets that never moved. */
    async nip04Encrypt(peerPubkey: Hex, plaintext: string) {
      return nip04.encrypt(secretKey, peerPubkey, plaintext)
    },
    async nip04Decrypt(peerPubkey: Hex, ciphertext: string) {
      return nip04.decrypt(secretKey, peerPubkey, ciphertext)
    },
  }

  return { signer, pubkey }
}
