/** NIP-57 zaps. */

import { verifyEvent } from 'nostr-tools/pure'
import { decode as decodeBech32Nostr } from 'nostr-tools/nip19'
import { ZapRequest as KIND_ZAP_REQUEST, Zap as KIND_ZAP_RECEIPT } from 'nostr-tools/kinds'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import type { EventTemplate, Hex, NostrEvent, Profile, RelayUrl, Signer, ZapReceipt, ZapTarget } from './types'

// --------------------------------------------------------------------------- Results.

export type ZapErrorCode =
  /** Profile has neither lud16 nor lud06. */
  | 'no-lightning-address'
  /** lud16/lud06 present but unparseable. */
  | 'bad-lightning-address'
  /** DNS/TLS/timeout, or a non-2xx from the lnurlp endpoint. */
  | 'lnurl-unreachable'
  /** Reached the server, but the payRequest document is malformed or an LNURL error. */
  | 'lnurl-invalid'
  /** Requested amount outside minSendable..maxSendable. */
  | 'amount-out-of-range'
  /** The callback answered, but with an error or without an invoice. */
  | 'callback-failed'
  /** The invoice we got back does not commit to what we asked. */
  | 'invoice-mismatch'
  | 'not-a-zap-receipt'
  /** Receipt id/sig do not check out. */
  | 'bad-signature'
  /** Receipt signed by someone other than the recipient's LNURL server key. */
  | 'wrong-issuer'
  | 'missing-bolt11'
  | 'bad-bolt11'
  /** No `description` tag, or it does not parse as a signed kind-9734. */
  | 'bad-zap-request'
  /** sha256(description) != the invoice's description_hash. */
  | 'description-hash-mismatch'
  /** Invoice amount disagrees with the zap request's amount tag. */
  | 'amount-mismatch'
  /** Receipt is for a different pubkey or a different note than we asked. */
  | 'target-mismatch'

export interface ZapError {
  code: ZapErrorCode
  message: string
}

export type ZapResult<T> = { ok: true; value: T } | { ok: false; error: ZapError }

function fail(code: ZapErrorCode, message: string): { ok: false; error: ZapError } {
  return { ok: false, error: { code, message } }
}

// --------------------------------------------------------------------------- HTTP.

/** Structural subset of `fetch`. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface ZapHttpOptions {
  fetch?: FetchLike
  /** Per-request budget. */
  timeoutMs?: number
}

const DEFAULT_HTTP_TIMEOUT_MS = 15_000

async function getJson(url: string, opts: ZapHttpOptions): Promise<ZapResult<unknown>> {
  const doFetch: FetchLike | undefined = opts.fetch ?? (typeof fetch === 'function' ? fetch : undefined)
  if (!doFetch) return fail('lnurl-unreachable', 'no fetch implementation available')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS)
  try {
    const res = await doFetch(url, { signal: controller.signal })
    if (!res.ok) return fail('lnurl-unreachable', `HTTP ${res.status} from ${url}`)
    return { ok: true, value: await res.json() }
  } catch (e) {
    return fail('lnurl-unreachable', `${url}: ${errorText(e)}`)
  } finally {
    clearTimeout(timer)
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------------------------------------------------------------------------.

const HEX64 = /^[0-9a-f]{64}$/

function isHex64(value: unknown): value is Hex {
  return typeof value === 'string' && HEX64.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** LUD-16: `user@domain` -> `https://domain/.well-known/lnurlp/user`. */
export function lightningAddressToUrl(address: string): string | null {
  // Wallets display lightning addresses with a ₿ sigil.
  const trimmed = address.trim().replace(/^₿/, '')
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return null

  const name = trimmed.slice(0, at)
  // Only the domain is case-folded: LUD-16 says nothing about folding the local part.
  const domain = trimmed.slice(at + 1).toLowerCase()

  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null
  // A name of "." or ".." would climb out of /.well-known/ and let a hostile profile.
  if (/^\.+$/.test(name)) return null
  if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes('.')) return null

  // Hidden services have no CA-issued certificate, so LUD-16 mandates plain http there.
  const scheme = domain.endsWith('.onion') ? 'http' : 'https'
  return `${scheme}://${domain}/.well-known/lnurlp/${name}`
}

/** LUD-06: bech32 `lnurl1...` (or a bare https URL, which some clients store in lud06). */
export function lnurlToUrl(lnurl: string): string | null {
  const raw = lnurl.trim().replace(/^lightning:/i, '')
  if (/^https?:\/\//i.test(raw)) return raw

  const decoded = bech32Decode(raw)
  if (!decoded || decoded.hrp !== 'lnurl') return null
  const bytes = wordsToBytes(decoded.words)
  if (!bytes) return null
  const url = new TextDecoder().decode(bytes)
  return /^https?:\/\//i.test(url) ? url : null
}

/** bech32 `lnurl1...` form of a pay endpoint, for the zap request's `lnurl` tag. */
export function encodeLnurl(url: string): string {
  return bech32Encode('lnurl', bytesToWords(utf8ToBytes(url)))
}

/** The lnurlp URL for a profile, preferring lud16 the way every other client does. */
export function zapEndpointUrl(recipient: Pick<Profile, 'lud16' | 'lud06'>): string | null {
  if (recipient.lud16) {
    const url = lightningAddressToUrl(recipient.lud16)
    if (url) return url
  }
  if (recipient.lud06) return lnurlToUrl(recipient.lud06)
  return null
}

export interface LnurlPayEndpoint {
  /** Where to GET an invoice. */
  callback: string
  minSendable: number
  maxSendable: number
  /** LUD-06 metadata string. Its sha256 is the description_hash of a NON-zap invoice. */
  metadata: string
  /** Max comment length on a plain LNURL payment. */
  commentAllowed: number
  /** Set only when the server advertises BOTH `allowsNostr: true` and a usable. */
  zapPubkey?: Hex
  /** The lnurlp URL these params came. */
  sourceUrl: string
  /** bech32 form of `sourceUrl`, echoed back in the zap request and the callback. */
  lnurl: string
}

/** Fetch and validate a recipient's LNURL-pay params. */
export async function resolveZapEndpoint(
  recipient: Pick<Profile, 'lud16' | 'lud06'>,
  opts: ZapHttpOptions = {},
): Promise<ZapResult<LnurlPayEndpoint>> {
  if (!recipient.lud16 && !recipient.lud06) {
    return fail('no-lightning-address', 'profile has no lud16 or lud06')
  }
  const url = zapEndpointUrl(recipient)
  if (!url) return fail('bad-lightning-address', `cannot parse ${recipient.lud16 ?? recipient.lud06}`)

  const res = await getJson(url, opts)
  if (!res.ok) return res
  return parseLnurlPayParams(res.value, url)
}

export function parseLnurlPayParams(body: unknown, sourceUrl: string): ZapResult<LnurlPayEndpoint> {
  if (!isRecord(body)) return fail('lnurl-invalid', `${sourceUrl} did not return a JSON object`)
  if (body['status'] === 'ERROR') {
    const reason = typeof body['reason'] === 'string' ? body['reason'] : 'unspecified'
    return fail('lnurl-invalid', `${sourceUrl}: ${reason}`)
  }
  if (body['tag'] !== 'payRequest') return fail('lnurl-invalid', `${sourceUrl} is not a payRequest`)

  const callback = body['callback']
  // A profile is attacker-controlled input.
  if (typeof callback !== 'string' || !/^https?:\/\//i.test(callback)) {
    return fail('lnurl-invalid', `${sourceUrl} has no usable callback URL`)
  }

  const minSendable = body['minSendable']
  const maxSendable = body['maxSendable']
  /** `maxSendable: 0` IS AN ANSWER, not a malformed document. */
  if (typeof maxSendable === 'number' && maxSendable === 0) {
    return fail('lnurl-invalid', `${sourceUrl} cannot receive payments right now (its wallet reports no receive capacity)`)
  }
  if (typeof minSendable !== 'number' || typeof maxSendable !== 'number' || minSendable > maxSendable) {
    return fail('lnurl-invalid', `${sourceUrl} has no usable min/maxSendable`)
  }

  const metadata = typeof body['metadata'] === 'string' ? body['metadata'] : ''
  const commentAllowed = typeof body['commentAllowed'] === 'number' ? body['commentAllowed'] : 0

  const endpoint: LnurlPayEndpoint = {
    callback,
    minSendable,
    maxSendable,
    metadata,
    commentAllowed,
    sourceUrl,
    lnurl: encodeLnurl(sourceUrl),
  }

  if (body['allowsNostr'] === true) {
    const advertised = body['nostrPubkey']
    // Spec says hex, but enough servers publish an npub that refusing it would strip zap.
    const hex =
      typeof advertised === 'string' && advertised.startsWith('npub1') ? npubToHex(advertised) : advertised
    if (isHex64(hex)) endpoint.zapPubkey = hex
  }

  return { ok: true, value: endpoint }
}

function npubToHex(npub: string): Hex | null {
  try {
    const decoded = decodeBech32Nostr(npub)
    return decoded.type === 'npub' ? decoded.data : null
  } catch {
    return null
  }
}

// --------------------------------------------------------------------------- Zap.

/** The relays tag rides along in a query string, and LNURL servers behind CDNs start. */
export const MAX_ZAP_REQUEST_RELAYS = 10

export interface ZapRequestTarget extends ZapTarget {
  /** `kind:pubkey:d-identifier` when zapping a replaceable event. */
  address?: string
  /** bech32 lnurl of the recipient's endpoint, per NIP-57's `lnurl` tag. */
  lnurl?: string
}

/** Build and sign the kind-9734. Throws on inputs that can only be a caller bug. */
export async function buildZapRequest(target: ZapRequestTarget, signer: Signer): Promise<NostrEvent> {
  if (!isHex64(target.recipientPubkey)) {
    throw new TypeError(`zap recipient must be 64-char lowercase hex, got ${String(target.recipientPubkey)}`)
  }
  if (target.eventId !== undefined && !isHex64(target.eventId)) {
    throw new TypeError(`zap eventId must be 64-char lowercase hex, got ${String(target.eventId)}`)
  }
  if (!Number.isSafeInteger(target.amountMsat) || target.amountMsat <= 0) {
    throw new RangeError(`zap amount must be a positive integer of millisats, got ${String(target.amountMsat)}`)
  }

  const relays = dedupe(target.relays).slice(0, MAX_ZAP_REQUEST_RELAYS)
  if (relays.length === 0) {
    // Without a relays tag the LNURL server has nowhere to publish the receipt.
    throw new RangeError('zap request needs at least one relay for the receipt')
  }

  const tags: string[][] = [
    ['relays', ...relays],
    ['amount', String(target.amountMsat)],
    ['p', target.recipientPubkey],
  ]
  if (target.lnurl) tags.push(['lnurl', target.lnurl])
  if (target.eventId) tags.push(['e', target.eventId])
  if (target.address) tags.push(['a', target.address])

  const template: EventTemplate = {
    kind: KIND_ZAP_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: target.comment ?? '',
  }
  return signer.signEvent(template)
}

function dedupe(values: RelayUrl[]): RelayUrl[] {
  return [...new Set(values.filter((v) => typeof v === 'string' && v.length > 0))]
}

// --------------------------------------------------------------------------- Invoice.

export type ZapInvoice =
  | {
      /** The LNURL server took the zap request. */
      zap: true
      /** Whether the invoice PROVES it will become a zap. */
      verified: boolean
      bolt11: string
      amountMsat: number
      zapRequest: NostrEvent
      /** Pubkey the receipt MUST be signed. */
      lnurlPubkey: Hex
      endpoint: LnurlPayEndpoint
    }
  | {
      /** Payable, but the recipient's server does not do nostr. */
      zap: false
      reason: 'no-nostr-support'
      bolt11: string
      amountMsat: number
      endpoint: LnurlPayEndpoint
    }

export interface CreateZapInvoiceInput {
  target: ZapRequestTarget
  recipient: Pick<Profile, 'lud16' | 'lud06'>
  signer: Signer
  http?: ZapHttpOptions
}

/** Resolve -> sign -> fetch invoice, in one call. */
export async function createZapInvoice(input: CreateZapInvoiceInput): Promise<ZapResult<ZapInvoice>> {
  const http = input.http ?? {}
  const resolved = await resolveZapEndpoint(input.recipient, http)
  if (!resolved.ok) return resolved
  const endpoint = resolved.value

  const amountMsat = input.target.amountMsat
  if (amountMsat < endpoint.minSendable || amountMsat > endpoint.maxSendable) {
    return fail(
      'amount-out-of-range',
      `${amountMsat} msat outside ${endpoint.minSendable}..${endpoint.maxSendable} accepted by ${endpoint.sourceUrl}`,
    )
  }

  const query = new URLSearchParams({ amount: String(amountMsat) })
  query.set('lnurl', endpoint.lnurl)

  let zapRequest: NostrEvent | null = null
  if (endpoint.zapPubkey) {
    zapRequest = await buildZapRequest({ ...input.target, lnurl: endpoint.lnurl }, input.signer)
    query.set('nostr', JSON.stringify(zapRequest))
  } else if (input.target.comment && endpoint.commentAllowed > 0) {
    // Without nostr support the comment has nowhere else to live.
    query.set('comment', input.target.comment.slice(0, endpoint.commentAllowed))
  }

  const separator = endpoint.callback.includes('?') ? '&' : '?'
  const res = await getJson(`${endpoint.callback}${separator}${query.toString()}`, http)
  if (!res.ok) return { ok: false, error: { ...res.error, code: 'callback-failed' } }

  const body = res.value
  if (!isRecord(body)) return fail('callback-failed', `${endpoint.callback} did not return a JSON object`)
  if (body['status'] === 'ERROR') {
    const reason = typeof body['reason'] === 'string' ? body['reason'] : 'unspecified'
    return fail('callback-failed', `${endpoint.callback}: ${reason}`)
  }
  const bolt11 = body['pr']
  if (typeof bolt11 !== 'string' || bolt11.length === 0) {
    return fail('callback-failed', `${endpoint.callback} returned no invoice`)
  }

  const invoice = decodeBolt11(bolt11)
  if (!invoice) return fail('invoice-mismatch', 'callback returned an undecodable invoice')
  if (invoice.amountMsat === null) {
    // An amountless invoice lets the wallet pay anything.
    return fail('invoice-mismatch', 'callback returned an amountless invoice')
  }
  if (invoice.amountMsat !== amountMsat) {
    return fail('invoice-mismatch', `asked for ${amountMsat} msat, invoice is for ${invoice.amountMsat}`)
  }

  if (zapRequest && endpoint.zapPubkey) {
    const expected = sha256Hex(query.get('nostr') ?? '')
    /* A COMMITMENT WE CANNOT MATCH IS FLAGGED, NOT REFUSED. */
    return {
      ok: true,
      value: {
        zap: true,
        verified: invoice.descriptionHash === expected || invoice.description === query.get('nostr'),
        bolt11,
        amountMsat: invoice.amountMsat,
        zapRequest,
        lnurlPubkey: endpoint.zapPubkey,
        endpoint,
      },
    }
  }

  // LUD-06 requires the invoice to commit to the metadata string.
  if (endpoint.metadata) {
    const metadataHash = sha256Hex(endpoint.metadata)
    const committed =
      invoice.descriptionHash === metadataHash ||
      (invoice.descriptionHash === undefined && invoice.description === endpoint.metadata)
    if (!committed) return fail('invoice-mismatch', 'invoice does not commit to the advertised LNURL metadata')
  }

  return {
    ok: true,
    value: { zap: false, reason: 'no-nostr-support', bolt11, amountMsat: invoice.amountMsat, endpoint },
  }
}

function sha256Hex(input: string): Hex {
  return bytesToHex(sha256(utf8ToBytes(input)))
}

// --------------------------------------------------------------------------- Receipt.

export interface ValidateZapReceiptInput {
  receipt: NostrEvent
  /** `nostrPubkey` advertised by the RECIPIENT's own lnurlp endpoint. */
  lnurlPubkey?: Hex
  /** When set, the receipt must pay this pubkey. */
  recipientPubkey?: Hex
  /** When set, the receipt must be for this note. */
  eventId?: Hex
}

/** Turn an untrusted kind-9735 into a ZapReceipt, or say why it is not one. */
export function validateZapReceipt(input: ValidateZapReceiptInput): ZapResult<ZapReceipt> {
  const { receipt } = input

  if (receipt.kind !== KIND_ZAP_RECEIPT) return fail('not-a-zap-receipt', `kind ${receipt.kind} is not 9735`)
  /* The issuer is RECORDED, not required. */
  const issuerVerified = isHex64(input.lnurlPubkey) && receipt.pubkey === input.lnurlPubkey
  if (!safeVerify(receipt)) return fail('bad-signature', 'receipt id/signature do not check out')

  const bolt11 = tagValue(receipt.tags, 'bolt11')
  if (!bolt11) return fail('missing-bolt11', 'receipt has no bolt11 tag')
  const invoice = decodeBolt11(bolt11)
  if (!invoice) return fail('bad-bolt11', 'receipt carries an undecodable invoice')

  const description = tagValue(receipt.tags, 'description')
  if (!description) return fail('bad-zap-request', 'receipt has no description tag')

  const zapRequest = parseSignedEvent(description)
  if (!zapRequest) return fail('bad-zap-request', 'description tag is not a well-formed event')
  if (zapRequest.kind !== KIND_ZAP_REQUEST) {
    return fail('bad-zap-request', `description tag holds kind ${zapRequest.kind}, expected 9734`)
  }
  if (!safeVerify(zapRequest)) return fail('bad-zap-request', 'embedded zap request is not validly signed')

  /** The link between "this payment happened" and "this person sent it". */
  const senderVerified = invoice.descriptionHash === sha256Hex(description)

  if (invoice.amountMsat === null) return fail('amount-mismatch', 'receipt invoice has no amount')
  const requested = tagValue(zapRequest.tags, 'amount')
  if (requested !== undefined && requested !== String(invoice.amountMsat)) {
    return fail('amount-mismatch', `zap request asked for ${requested} msat, invoice is for ${invoice.amountMsat}`)
  }

  const recipientPubkey = tagValue(zapRequest.tags, 'p')
  if (!isHex64(recipientPubkey)) return fail('bad-zap-request', 'zap request has no valid p tag')
  const receiptRecipient = tagValue(receipt.tags, 'p')
  if (receiptRecipient !== undefined && receiptRecipient !== recipientPubkey) {
    return fail('target-mismatch', 'receipt and zap request name different recipients')
  }
  if (input.recipientPubkey !== undefined && recipientPubkey !== input.recipientPubkey) {
    return fail('target-mismatch', `receipt pays ${recipientPubkey}, expected ${input.recipientPubkey}`)
  }

  const eventId = tagValue(zapRequest.tags, 'e')
  const receiptEventId = tagValue(receipt.tags, 'e')
  if (eventId !== undefined && receiptEventId !== undefined && receiptEventId !== eventId) {
    return fail('target-mismatch', 'receipt and zap request name different events')
  }
  if (input.eventId !== undefined && eventId !== input.eventId) {
    return fail('target-mismatch', `receipt is for event ${String(eventId)}, expected ${input.eventId}`)
  }

  // The optional uppercase P is the server restating the sender.
  const claimedSender = tagValue(receipt.tags, 'P')
  if (claimedSender !== undefined && claimedSender !== zapRequest.pubkey) {
    return fail('target-mismatch', 'receipt P tag disagrees with the signed zap request')
  }

  const comment = zapRequest.content.trim()
  const value: ZapReceipt = {
    issuerVerified,
    id: receipt.id,
    senderPubkey: zapRequest.pubkey,
    recipientPubkey,
    amountMsat: invoice.amountMsat,
    createdAt: receipt.created_at,
    bolt11,
    senderVerified,
  }
  if (eventId !== undefined) value.eventId = eventId
  if (comment.length > 0) value.comment = comment
  return { ok: true, value }
}

function tagValue(tags: string[][], name: string): string | undefined {
  for (const tag of tags) {
    if (tag[0] === name && tag[1] !== undefined) return tag[1]
  }
  return undefined
}

/** VERIFIED ONCE PER EVENT, EVER. */
const VERIFY_CACHE_MAX = 20_000
const verified = new Map<string, boolean>()

/** verifyEvent throws on some malformed shapes, and this input is hostile by definition. */
function safeVerify(event: NostrEvent): boolean {
  // A malformed event with no id or sig is not cacheable and not valid.
  const key =
    typeof event.id === 'string' && typeof event.sig === 'string' ? `${event.id}:${event.sig}` : undefined
  if (key !== undefined) {
    const held = verified.get(key)
    if (held !== undefined) return held
  }

  let result: boolean
  try {
    result = verifyEvent(event)
  } catch {
    result = false
  }

  if (key !== undefined) {
    if (verified.size >= VERIFY_CACHE_MAX) {
      const oldest = verified.keys().next().value
      if (oldest !== undefined) verified.delete(oldest)
    }
    verified.set(key, result)
  }
  return result
}

/** Forgets every cached verification. */
export function forgetVerifiedSignatures(): void {
  verified.clear()
}

function parseSignedEvent(json: string): NostrEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (!isHex64(parsed['id']) || !isHex64(parsed['pubkey'])) return null
  if (typeof parsed['sig'] !== 'string' || !/^[0-9a-f]{128}$/.test(parsed['sig'])) return null
  if (typeof parsed['kind'] !== 'number' || typeof parsed['content'] !== 'string') return null
  if (typeof parsed['created_at'] !== 'number') return null
  const tags = parsed['tags']
  if (!Array.isArray(tags)) return null
  const cleanTags: string[][] = []
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.some((item) => typeof item !== 'string')) return null
    cleanTags.push(tag as string[])
  }
  return {
    id: parsed['id'],
    pubkey: parsed['pubkey'],
    sig: parsed['sig'],
    kind: parsed['kind'],
    content: parsed['content'],
    created_at: parsed['created_at'],
    tags: cleanTags,
  }
}

// --------------------------------------------------------------------------- bolt11.

export interface DecodedInvoice {
  /** null for an "any amount" invoice. */
  amountMsat: number | null
  timestamp: number
  expirySeconds: number
  network: string
  paymentHash?: Hex
  /** The `h` field. For a zap this is sha256 of the zap request JSON. */
  descriptionHash?: Hex
  /** The `d` field, when the payee inlined the description instead of hashing. */
  description?: string
}

/** Enough of BOLT-11 to answer "how much, and what does it commit to". */
export function decodeBolt11(invoice: string): DecodedInvoice | null {
  const decoded = bech32Decode(invoice.trim().replace(/^lightning:/i, ''))
  if (!decoded) return null

  const hrp = /^ln(bcrt|bc|tbs|tb|sb)(\d+)?([munp])?$/.exec(decoded.hrp)
  if (!hrp) return null
  const network = hrp[1] ?? ''
  const amountMsat = hrpAmountToMsat(hrp[2], hrp[3])
  if (amountMsat === undefined) return null

  const words = decoded.words
  // 7 words of timestamp, then fields, then a fixed 520-bit signature at the end.
  const fieldsEnd = words.length - SIGNATURE_WORDS
  if (fieldsEnd < TIMESTAMP_WORDS) return null

  let timestamp = 0
  for (let i = 0; i < TIMESTAMP_WORDS; i++) timestamp = timestamp * 32 + (words[i] ?? 0)

  const result: DecodedInvoice = { amountMsat, timestamp, expirySeconds: DEFAULT_EXPIRY_SECONDS, network }

  let pos = TIMESTAMP_WORDS
  while (pos + 3 <= fieldsEnd) {
    const type = words[pos]
    const lenHigh = words[pos + 1]
    const lenLow = words[pos + 2]
    if (type === undefined || lenHigh === undefined || lenLow === undefined) return null
    const length = lenHigh * 32 + lenLow
    pos += 3
    if (pos + length > fieldsEnd) return null
    const data = words.slice(pos, pos + length)
    pos += length

    switch (type) {
      case FIELD_PAYMENT_HASH: {
        const bytes = wordsToBytes(data)
        if (bytes && bytes.length === 32) result.paymentHash = bytesToHex(bytes)
        break
      }
      case FIELD_DESCRIPTION_HASH: {
        const bytes = wordsToBytes(data)
        if (bytes && bytes.length === 32) result.descriptionHash = bytesToHex(bytes)
        break
      }
      case FIELD_DESCRIPTION: {
        const bytes = wordsToBytes(data)
        if (bytes) result.description = new TextDecoder().decode(bytes)
        break
      }
      case FIELD_EXPIRY: {
        let expiry = 0
        for (const word of data) expiry = expiry * 32 + word
        result.expirySeconds = expiry
        break
      }
      default:
        break
    }
  }

  return result
}

const TIMESTAMP_WORDS = 7
const SIGNATURE_WORDS = 104
const DEFAULT_EXPIRY_SECONDS = 3600
const FIELD_PAYMENT_HASH = 1
const FIELD_DESCRIPTION = 13
const FIELD_EXPIRY = 6
const FIELD_DESCRIPTION_HASH = 23

/** `undefined` = malformed, `null` = the invoice deliberately has no amount. */
function hrpAmountToMsat(digits: string | undefined, multiplier: string | undefined): number | null | undefined {
  if (digits === undefined || digits.length === 0) return multiplier === undefined ? null : undefined

  // Amounts are denominated in bitcoin, so 21 BTC in millisats overflows a float.
  const value = BigInt(digits)
  let msat: bigint
  switch (multiplier) {
    case undefined:
      msat = value * 100_000_000_000n
      break
    case 'm':
      msat = value * 100_000_000n
      break
    case 'u':
      msat = value * 100_000n
      break
    case 'n':
      msat = value * 100n
      break
    case 'p':
      // A pico-bitcoin is a tenth of a millisat.
      if (value % 10n !== 0n) return undefined
      msat = value / 10n
      break
    default:
      return undefined
  }
  if (msat > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
  return Number(msat)
}

// --------------------------------------------------------------------------- bech32.

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function bech32Polymod(values: number[]): number {
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) checksum ^= BECH32_GENERATOR[i] ?? 0
    }
  }
  return checksum
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = []
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5)
  out.push(0)
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31)
  return out
}

/** Plain bech32, minus the 90-character cap: both LNURL strings and bolt11 invoices. */
function bech32Decode(input: string): { hrp: string; words: number[] } | null {
  const raw = input.trim()
  if (raw.length < 8) return null
  // Mixed case makes the checksum ambiguous, so BIP-173 rejects it outright.
  if (raw !== raw.toLowerCase() && raw !== raw.toUpperCase()) return null

  const lower = raw.toLowerCase()
  const separator = lower.lastIndexOf('1')
  if (separator < 1 || separator + 7 > lower.length) return null

  const hrp = lower.slice(0, separator)
  const words: number[] = []
  for (let i = separator + 1; i < lower.length; i++) {
    const value = BECH32_CHARSET.indexOf(lower.charAt(i))
    if (value === -1) return null
    words.push(value)
  }
  if (bech32Polymod([...bech32HrpExpand(hrp), ...words]) !== 1) return null
  return { hrp, words: words.slice(0, -6) }
}

function bech32Encode(hrp: string, words: number[]): string {
  const checksumInput = [...bech32HrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]
  const polymod = bech32Polymod(checksumInput) ^ 1
  const checksum: number[] = []
  for (let i = 0; i < 6; i++) checksum.push((polymod >> (5 * (5 - i))) & 31)

  let out = `${hrp}1`
  for (const word of [...words, ...checksum]) out += BECH32_CHARSET.charAt(word)
  return out
}

/** 5-bit groups -> bytes. Trailing bits that do not fill a byte are padding. */
function wordsToBytes(words: number[]): Uint8Array | null {
  let acc = 0
  let bits = 0
  const out: number[] = []
  for (const word of words) {
    if (word < 0 || word > 31) return null
    acc = (acc << 5) | word
    bits += 5
    while (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

function bytesToWords(bytes: Uint8Array): number[] {
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

/** THE ZAP INSIDE A LIGHTNING PAYMENT, with no relay involved. */
export function zapRequestFromInvoiceDescription(description: string | undefined): NostrEvent | null {
  if (description === undefined) return null
  const trimmed = description.trim()
  // Cheap rejections first: this runs over every row of a wallet's history.
  if (!trimmed.startsWith('{') || !trimmed.includes('"kind"')) return null
  const event = parseSignedEvent(trimmed)
  if (event === null || event.kind !== KIND_ZAP_REQUEST) return null
  return safeVerify(event) ? event : null
}

/** The zap request a RECEIPT carries, so a wallet-derived zap and a relay-derived one. */
export function zapRequestOfReceipt(receipt: NostrEvent): NostrEvent | null {
  const description = receipt.tags.find(tag => tag[0] === 'description')?.[1]
  return zapRequestFromInvoiceDescription(description)
}

/** The note a zap request names, if it names one. */
export function zappedEventId(request: NostrEvent): string | undefined {
  return request.tags.find(tag => tag[0] === 'e' && typeof tag[1] === 'string')?.[1]
}
