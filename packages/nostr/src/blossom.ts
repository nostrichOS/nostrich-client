import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import type { BlobDescriptor, Hex, NostrEvent, Signer, UploadResult } from './types'

/** Blossom client. */

/** BUD-01 authorization event. */
export const BLOSSOM_AUTH_KIND = 24242

/** Where an upload goes, and where a missing blob is looked. */
/** How many copies to PAY for when mirroring is unavailable. */
const COPIES = 2

/** Where a blob goes, and why these three. */
export const DEFAULT_BLOSSOM_SERVERS: readonly string[] = [
  'https://blossom.nostr.build',
  'https://cdn.hzrd149.com',
  'https://cdn.nostrcheck.me',
]

/** The same blob, on the other servers we know. */
export function blossomAlternatives(
  url: string,
  servers: readonly string[] = DEFAULT_BLOSSOM_SERVERS,
): string[] {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return []
  }
  const file = parsed.pathname.split('/').pop() ?? ''
  // The hash, and the extension the server appended.
  const match = /^([0-9a-f]{64})(\.[a-z0-9]{1,8})?$/i.exec(file)
  if (match === null) return []
  const hash = (match[1] ?? '').toLowerCase()
  const ext = match[2] ?? ''

  const out: string[] = []

  for (const server of servers) {
    let host: string
    try {
      host = new URL(server).host
    } catch {
      continue
    }
    // Never hand back the URL that just failed.
    if (host === parsed.host) continue
    out.push(`${server.replace(/\/+$/, '')}/${hash}${ext}`)
  }
  return out
}

/** Long enough that a large video on mobile data finishes before the server calls. */
const DEFAULT_AUTH_TTL_SECONDS = 600
/** Servers reject an auth event whose created_at is in the future. */
const CLOCK_SKEW_SECONDS = 10

const HEX64 = /^[0-9a-f]{64}$/

export type BlossomVerb = 'upload' | 'list' | 'delete' | 'get'

export type BlobInput = Blob | ArrayBuffer | Uint8Array

export class BlossomError extends Error {
  readonly server: string
  readonly status?: number
  readonly reason?: string

  constructor(message: string, info: { server: string; status?: number; reason?: string }) {
    super(message)
    this.name = 'BlossomError'
    this.server = info.server
    this.status = info.status
    this.reason = info.reason
  }
}

export interface BlossomRequestOptions {
  /** Injectable transport, for tests and for platforms without a global fetch. */
  fetch?: typeof fetch
  /** Caller-owned cancellation. */
  signal?: AbortSignal
  /** Lifetime of the auth event, in seconds. */
  expiresInSeconds?: number
}

export interface UploadOptions extends BlossomRequestOptions {
  /** Overrides the MIME type. */
  type?: string
  /** Push the bytes to a second server when it cannot mirror. */
  copyWhenMirrorFails?: boolean
}

export interface ListOptions extends BlossomRequestOptions {
  /** Unix seconds, inclusive bounds on `uploaded`. */
  since?: number
  until?: number
}

export interface BlossomAuthParams {
  verb: BlossomVerb
  /** SHA-256 of the payload. Required for upload and delete, ignored by list. */
  hashes?: Hex[]
  expiresInSeconds?: number
  /** Shown to the user by NIP-46/NIP-07 signers when they prompt for the signature. */
  content?: string
  server?: string
}

/** SHA-256 of the payload, lowercase hex. */
export async function blobSha256(input: BlobInput): Promise<Hex> {
  return bytesToHex(sha256(await toBytes(input)))
}

/** A kind-24242 event signed by the user's own key. */
export async function createBlossomAuth(signer: Signer, params: BlossomAuthParams): Promise<NostrEvent> {
  const now = Math.floor(Date.now() / 1000) - CLOCK_SKEW_SECONDS
  const tags: string[][] = [['t', params.verb]]
  for (const hash of params.hashes ?? []) tags.push(['x', hash.toLowerCase()])
  /* TWO forms of the same tag, and both are needed. */
  if (params.server !== undefined) {
    const origin = normalizeServer(params.server)
    tags.push(['server', origin])
    const host = hostOf(origin)
    if (host !== undefined && host !== origin) tags.push(['server', host])
  }
  tags.push(['expiration', String(now + (params.expiresInSeconds ?? DEFAULT_AUTH_TTL_SECONDS))])

  return signer.signEvent({
    kind: BLOSSOM_AUTH_KIND,
    created_at: now,
    content: params.content ?? defaultContent(params.verb),
    tags,
  })
}

/** `https://blossom.band` -> `blossom.band`. */
function hostOf(origin: string): string | undefined {
  try {
    return new URL(origin).host
  } catch {
    return undefined
  }
}

export function blossomAuthHeader(auth: NostrEvent): string {
  return `Nostr ${toBase64(utf8(JSON.stringify(auth)))}`
}

/** Canonical BUD-02 URL for a hash on a given server. */
export function blobUrl(server: string, hash: Hex, ext?: string): string {
  return `${normalizeServer(server)}/${hash.toLowerCase()}${ext ? (ext.startsWith('.') ? ext : `.${ext}`) : ''}`
}

/** BUD-02 `PUT /upload`. */
export async function uploadBlob(
  server: string,
  input: BlobInput,
  signer: Signer,
  options: UploadOptions = {},
): Promise<BlobDescriptor> {
  const bytes = await toBytes(input)
  const hash = bytesToHex(sha256(bytes))
  const type = options.type ?? mimeOf(input)

  const auth = await createBlossomAuth(signer, {
    verb: 'upload',
    hashes: [hash],
    server,
    expiresInSeconds: options.expiresInSeconds,
    content: 'Upload blob',
  })

  /** ASK BEFORE SENDING. */
  await refuseIfKnownTooLarge(server, {
    hash,
    size: bytes.length,
    skip: bytes.length < PREFLIGHT_MIN_BYTES,
    type,
    auth,
    fetchImpl: options.fetch,
    signal: options.signal,
  })

  const response = await send(server, '/upload', {
    method: 'PUT',
    body: bytes,
    headers: {
      Authorization: blossomAuthHeader(auth),
      'Content-Type': type ?? 'application/octet-stream',
    },
    fetchImpl: options.fetch,
    signal: options.signal,
  })

  return readDescriptor(await response.text(), { server, hash, size: bytes.length, type })
}

/** BUD-04 `POST /mirror`. */
export async function mirrorBlob(
  server: string,
  source: { url: string; sha256: Hex },
  signer: Signer,
  options: BlossomRequestOptions = {},
): Promise<BlobDescriptor> {
  const auth = await createBlossomAuth(signer, {
    // Mirroring is authorized as an upload.
    verb: 'upload',
    hashes: [source.sha256],
    server,
    expiresInSeconds: options.expiresInSeconds,
    content: 'Mirror blob',
  })

  const response = await send(server, '/mirror', {
    method: 'POST',
    body: JSON.stringify({ url: source.url }),
    headers: {
      Authorization: blossomAuthHeader(auth),
      'Content-Type': 'application/json',
    },
    fetchImpl: options.fetch,
    signal: options.signal,
  })

  return readDescriptor(await response.text(), { server, hash: source.sha256, size: 0 })
}

/** Upload once, mirror everywhere else. */
export async function uploadWithMirrors(
  servers: readonly string[],
  input: BlobInput,
  signer: Signer,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const targets = servers.filter((server) => server.trim().length > 0)
  if (targets.length === 0) throw new Error('uploadWithMirrors requires at least one server')

  // Hash and buffer once here: uploadBlob would otherwise re-read a Blob per attempt.
  const bytes = await toBytes(input)
  const failures: Array<{ server: string; error: string; status?: number }> = []

  let primary: BlobDescriptor | null = null
  let primaryServer = ''
  for (const server of targets) {
    try {
      primary = await uploadBlob(server, bytes, signer, { ...options, type: options.type ?? mimeOf(input) })
      primaryServer = server
      break
    } catch (error) {
      failures.push({
        server,
        error: describe(error),
        ...(error instanceof BlossomError && error.status !== undefined ? { status: error.status } : {}),
      })
    }
  }

  if (!primary) {
    /* SAY WHICH KIND. */
    const every = (status: number): boolean =>
      failures.length > 0 && failures.every((failure) => failure.status === status)
    const message = every(413)
      ? 'Too large for the upload servers.'
      : every(402)
        ? 'The upload servers want a paid account for a file this size.'
        : every(401)
          ? 'The upload servers refused the signature on this upload.'
          : `no Blossom server accepted the blob (${failures.length} tried)`

    throw new BlossomError(message, {
      server: targets[0] ?? '',
      reason: failures.map((failure) => `${failure.server}: ${failure.error}`).join('; '),
    })
  }

  const accepted = primary
  // Some servers re-encode on ingest (stripping EXIF, transcoding) and hand back.
  const storedHash = accepted.sha256

  /* MIRROR TO EVERY OTHER SERVER, including ones that just refused the upload. */
  /* ── /mirror is gone from the ecosystem, so the second copy is a second UPLOAD. */
  const urls = [accepted.url]
  for (const server of targets) {
    if (server === primaryServer) continue
    try {
      const mirrored = await mirrorBlob(server, { url: accepted.url, sha256: storedHash }, signer, options)
      urls.push(mirrored.url)
      // The earlier upload failure is no longer interesting: the bytes are on this server.
      const stale = failures.findIndex((failure) => failure.server === server)
      if (stale !== -1) failures.splice(stale, 1)
    } catch (error) {
      /* The CAP is here, on the fallback only. */
      if (options.copyWhenMirrorFails === false || urls.length >= COPIES) {
        failures.push({ server, error: describe(error) })
        continue
      }
      try {
        const copied = await uploadBlob(server, bytes, signer, {
          ...options,
          type: options.type ?? mimeOf(input),
        })
        urls.push(copied.url)
        const stale = failures.findIndex((failure) => failure.server === server)
        if (stale !== -1) failures.splice(stale, 1)
      } catch (second) {
        // Both routes refused.
        failures.push({ server, error: `${describe(error)} (upload also failed: ${describe(second)})` })
      }
    }
  }

  return {
    sha256: storedHash,
    urls,
    size: accepted.size > 0 ? accepted.size : bytes.length,
    ...(accepted.type !== undefined ? { type: accepted.type } : {}),
    failures,
  }
}

/** BUD-02 `GET /list/<pubkey>`. */
export async function listBlobs(
  server: string,
  pubkey: Hex,
  signer: Signer | null = null,
  options: ListOptions = {},
): Promise<BlobDescriptor[]> {
  const query = new URLSearchParams()
  if (options.since !== undefined) query.set('since', String(options.since))
  if (options.until !== undefined) query.set('until', String(options.until))
  const queryString = query.toString()
  const suffix = queryString.length > 0 ? `?${queryString}` : ''

  const headers: Record<string, string> = {}
  if (signer) {
    const auth = await createBlossomAuth(signer, {
      verb: 'list',
      server,
      expiresInSeconds: options.expiresInSeconds,
      content: 'List blobs',
    })
    headers.Authorization = blossomAuthHeader(auth)
  }

  const response = await send(server, `/list/${pubkey.toLowerCase()}${suffix}`, {
    method: 'GET',
    headers,
    fetchImpl: options.fetch,
    signal: options.signal,
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(await response.text())
  } catch {
    throw new BlossomError('list returned a non-JSON body', { server: normalizeServer(server) })
  }
  if (!Array.isArray(parsed)) return []

  const blobs: BlobDescriptor[] = []
  for (const entry of parsed) {
    const blob = coerceDescriptor(entry, server)
    if (blob) blobs.push(blob)
  }
  return blobs
}

/** BUD-02 `DELETE /<sha256>`. */
export async function deleteBlob(
  server: string,
  hash: Hex,
  signer: Signer,
  options: BlossomRequestOptions = {},
): Promise<void> {
  const normalized = hash.toLowerCase()
  const auth = await createBlossomAuth(signer, {
    verb: 'delete',
    hashes: [normalized],
    server,
    expiresInSeconds: options.expiresInSeconds,
    content: 'Delete blob',
  })

  await send(server, `/${normalized}`, {
    method: 'DELETE',
    headers: { Authorization: blossomAuthHeader(auth) },
    fetchImpl: options.fetch,
    signal: options.signal,
  })
}

export interface ImetaExtras {
  /** `800x600`, or the pair. Without it clients reflow the feed once the image loads. */
  dim?: string | { width: number; height: number }
  blurhash?: string
  alt?: string
}

/** NIP-92 `imeta` tag. */
export function buildImetaTag(blob: BlobDescriptor | UploadResult, extras: ImetaExtras = {}): string[] {
  const urls = 'urls' in blob ? blob.urls : [blob.url]
  const primary = urls[0]
  if (primary === undefined) throw new Error('buildImetaTag needs at least one URL')

  const tag = ['imeta', `url ${primary}`]
  if (blob.type !== undefined && blob.type.length > 0) tag.push(`m ${blob.type}`)
  tag.push(`x ${blob.sha256}`)
  if (blob.size > 0) tag.push(`size ${blob.size}`)
  if (extras.dim !== undefined) {
    tag.push(`dim ${typeof extras.dim === 'string' ? extras.dim : `${extras.dim.width}x${extras.dim.height}`}`)
  }
  if (extras.blurhash !== undefined && extras.blurhash.length > 0) tag.push(`blurhash ${extras.blurhash}`)
  if (extras.alt !== undefined && extras.alt.length > 0) tag.push(`alt ${extras.alt}`)
  for (const fallback of urls.slice(1)) tag.push(`fallback ${fallback}`)
  return tag
}

export function normalizeServer(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** WHO RUNS IT, which is not the same as what it is called. */
const OPERATORS: Readonly<Record<string, string>> = {
  'blossom.band': 'nostr.build',
  'blossom.nostr.build': 'nostr.build',
  'cdn.nostr.build': 'nostr.build',
  'nostr.build': 'nostr.build',
}

export function blossomOperator(server: string): string {
  const host = hostOf(normalizeServer(server))?.toLowerCase()
  if (host === undefined) return server.toLowerCase()
  if (host === 'blossom.band' || host.endsWith('.blossom.band')) return 'nostr.build'
  return OPERATORS[host] ?? host
}

/** How many servers one upload may touch. */
const MAX_UPLOAD_TARGETS = 4

/** Where THIS author's upload should go: their own servers first, ours behind them. */
export function uploadServers(
  authorServers: readonly string[],
  defaults: readonly string[] = DEFAULT_BLOSSOM_SERVERS,
): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const server of [...authorServers, ...defaults]) {
    if (typeof server !== 'string' || server.trim().length === 0) continue
    const origin = normalizeServer(server)
    if (seen.has(origin)) continue
    seen.add(origin)
    ordered.push(origin)
  }
  const first = ordered[0]
  if (first !== undefined) {
    const operator = blossomOperator(first)
    const other = ordered.findIndex((server, index) => index > 0 && blossomOperator(server) !== operator)
    if (other > 1) {
      const [promoted] = ordered.splice(other, 1)
      if (promoted !== undefined) ordered.splice(1, 0, promoted)
    }
  }
  return ordered.slice(0, MAX_UPLOAD_TARGETS)
}

/** The BUD-06 pre-flight. */
/** Below this, the pre-flight cannot change the answer, so it is not worth a round trip. */
const PREFLIGHT_MIN_BYTES = 8 * 1024 * 1024

async function refuseIfKnownTooLarge(
  server: string,
  input: {
    hash: Hex
    size: number
    type: string | undefined
    auth: NostrEvent
    skip: boolean
    fetchImpl?: typeof fetch
    signal?: AbortSignal
  },
): Promise<void> {
  if (input.skip) return
  try {
    await send(server, '/upload', {
      method: 'HEAD',
      headers: {
        Authorization: blossomAuthHeader(input.auth),
        'X-SHA-256': input.hash,
        'X-Content-Length': String(input.size),
        ...(input.type === undefined ? {} : { 'X-Content-Type': input.type }),
      },
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  } catch (error) {
    // 413 Payload Too Large, 402 Payment Required.
    if (error instanceof BlossomError && (error.status === 413 || error.status === 402)) throw error
  }
}

async function send(
  server: string,
  path: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: Uint8Array | string
    fetchImpl?: typeof fetch
    signal?: AbortSignal
  },
): Promise<Response> {
  const base = normalizeServer(server)
  const fetchImpl =
    init.fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (!fetchImpl) throw new BlossomError('no fetch implementation available', { server: base })

  let response: Response
  try {
    response = await fetchImpl(`${base}${path}`, {
      method: init.method,
      headers: init.headers,
      // The DOM lib narrowed BufferSource to ArrayBuffer-backed views, while hashing.
      ...(init.body !== undefined ? { body: init.body as BodyInit } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    })
  } catch (error) {
    throw new BlossomError(`${base} unreachable: ${describe(error)}`, { server: base })
  }

  if (!response.ok) {
    // BUD-01 puts the human-readable rejection in X-Reason.
    const reason = response.headers.get('X-Reason') ?? (await safeText(response))
    throw new BlossomError(`${base} rejected ${init.method} ${path}: ${response.status}${reason ? ` ${reason}` : ''}`, {
      server: base,
      status: response.status,
      ...(reason ? { reason } : {}),
    })
  }
  return response
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200)
  } catch {
    return ''
  }
}

function readDescriptor(
  body: string,
  fallback: { server: string; hash: Hex; size: number; type?: string },
): BlobDescriptor {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(body)
  } catch {
    // A 200 with an unparseable body still means the bytes landed, and the blob.
    parsed = null
  }
  const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}

  const reported = typeof record.sha256 === 'string' ? record.sha256.toLowerCase() : ''
  const hash = HEX64.test(reported) ? reported : fallback.hash
  const url = typeof record.url === 'string' && record.url.length > 0 ? record.url : blobUrl(fallback.server, hash)
  const size = typeof record.size === 'number' && record.size > 0 ? record.size : fallback.size
  const type = typeof record.type === 'string' && record.type.length > 0 ? record.type : fallback.type
  const uploaded =
    typeof record.uploaded === 'number' && record.uploaded > 0 ? record.uploaded : Math.floor(Date.now() / 1000)

  return { sha256: hash, url, size, uploaded, ...(type !== undefined ? { type } : {}) }
}

function coerceDescriptor(entry: unknown, server: string): BlobDescriptor | null {
  if (typeof entry !== 'object' || entry === null) return null
  const record = entry as Record<string, unknown>
  const hash = typeof record.sha256 === 'string' ? record.sha256.toLowerCase() : ''
  if (!HEX64.test(hash)) return null
  const type = typeof record.type === 'string' && record.type.length > 0 ? record.type : undefined
  return {
    sha256: hash,
    url: typeof record.url === 'string' && record.url.length > 0 ? record.url : blobUrl(server, hash),
    size: typeof record.size === 'number' ? record.size : 0,
    uploaded: typeof record.uploaded === 'number' ? record.uploaded : 0,
    ...(type !== undefined ? { type } : {}),
  }
}

async function toBytes(input: BlobInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (typeof input.arrayBuffer !== 'function') {
    throw new TypeError('Blob input has no arrayBuffer(); pass a Uint8Array on this platform')
  }
  return new Uint8Array(await input.arrayBuffer())
}

function mimeOf(input: BlobInput): string | undefined {
  if (typeof Blob !== 'undefined' && input instanceof Blob && input.type.length > 0) return input.type
  return undefined
}

function defaultContent(verb: BlossomVerb): string {
  return verb === 'upload' ? 'Upload blob' : verb === 'delete' ? 'Delete blob' : `${verb} blob`
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Hand-rolled because the two obvious shortcuts both break somewhere we ship: `btoa`. */
function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    const triple = (b0 << 16) | (b1 << 8) | b2
    out += B64_ALPHABET.charAt((triple >> 18) & 63)
    out += B64_ALPHABET.charAt((triple >> 12) & 63)
    out += i + 1 < bytes.length ? B64_ALPHABET.charAt((triple >> 6) & 63) : '='
    out += i + 2 < bytes.length ? B64_ALPHABET.charAt(triple & 63) : '='
  }
  return out
}

/** The pixel size a note claims for one of its images, from its NIP-92 `imeta` tag. */
export function imetaDimFor(
  tags: readonly (readonly string[])[],
  url: string,
): { width: number; height: number } | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue
    // Each field is a single "key value" string.
    let matches = false
    let dim: string | undefined
    for (const field of tag.slice(1)) {
      if (typeof field !== 'string') continue
      if (field.startsWith('url ') && field.slice(4).trim() === url) matches = true
      else if (field.startsWith('dim ')) dim = field.slice(4).trim()
    }
    if (!matches || dim === undefined) continue

    const parts = dim.toLowerCase().split('x')
    const width = Number(parts[0])
    const height = Number(parts[1])
    // A zero height would divide to Infinity downstream and blow out the layout.
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue
    return { width, height }
  }
  return undefined
}

/** A smaller copy of the same picture, if the note published one. */
export function imetaThumbFor(
  tags: readonly (readonly string[])[],
  url: string,
): string | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue
    let matches = false
    let thumb: string | undefined
    for (const field of tag.slice(1)) {
      if (typeof field !== 'string') continue
      if (field.startsWith('url ') && field.slice(4).trim() === url) matches = true
      else if (field.startsWith('thumb ')) thumb = field.slice(6).trim()
    }
    if (!matches || thumb === undefined || thumb === '') continue
    // Only https, and never the URL we already tried.
    if (!/^https:\/\//i.test(thumb) || thumb === url) continue
    return thumb
  }
  return undefined
}

/** The three shapes a rail cell is allowed to be: vertical, square, landscape. */
export type MediaPreset = 'vertical' | 'square' | 'landscape'

/** Width ÷ height for each frame: 3:4, 1:1, 16:9. */
export const MEDIA_PRESET_RATIO: Record<MediaPreset, number> = {
  vertical: 3 / 4,
  square: 1,
  landscape: 16 / 9,
}

/** Narrower than this is a portrait. */
const VERTICAL_BELOW = 0.9
const LANDSCAPE_ABOVE = 1.15

export function mediaPreset(ratio: number | undefined): MediaPreset {
  // Nothing known yet.
  if (ratio === undefined || !Number.isFinite(ratio) || ratio <= 0) return 'square'
  if (ratio < VERTICAL_BELOW) return 'vertical'
  if (ratio > LANDSCAPE_ABOVE) return 'landscape'
  return 'square'
}

/** ONE frame for a whole post's gallery. */
export function galleryPreset(ratios: readonly (number | undefined)[]): MediaPreset {
  if (ratios.length === 0) return 'square'
  const votes: Record<MediaPreset, number> = { vertical: 0, square: 0, landscape: 0 }
  for (const ratio of ratios) votes[mediaPreset(ratio)] += 1

  // Shortest-first, so a tie resolves toward the frame that crops less badly.
  const order: MediaPreset[] = ['vertical', 'square', 'landscape']
  let winner: MediaPreset = 'square'
  let best = -1
  for (const preset of order) {
    if (votes[preset] > best) {
      best = votes[preset]
      winner = preset
    }
  }
  return winner
}
