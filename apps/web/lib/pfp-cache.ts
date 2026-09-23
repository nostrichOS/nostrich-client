import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isPrivateUrl } from '@nostrich/nostr'

import type { PfpVariant } from './pfp-variants'

/** A copy of the images this app has shown: profile pictures, covers, and note media. */

/** Mounted from a named volume in compose. */
const ROOT = process.env['PFP_CACHE_DIR'] ?? '/data/pfp'

/** Refuse anything larger. A profile picture that is 4 MB is a mistake, not a portrait. */
const MAX_BYTES = 4 * 1024 * 1024

/** How long the origin gets, headers AND body. */
const ORIGIN_TIMEOUT_MS = 15_000

/** How long a stored copy is served before we ask the origin whether it changed. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Entries untouched for this long are swept: nobody's profile points at them any more. */
const SWEEP_AFTER_MS = 30 * 24 * 60 * 60 * 1000

/** One in this many writes runs the sweep, so it costs nothing on the common path. */
const SWEEP_ODDS = 200

/** How long a URL that failed is remembered as failed, and how that grows. */
const RETRY_BACKOFF_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000] as const

/** In memory, not on disk, and deliberately. */
interface Failure {
  /** When the most recent attempt failed. */
  at: number
  /** Consecutive failures. Forgotten entirely the moment one succeeds. */
  strikes: number
}

const failures = new Map<string, Failure>()

/** How many times in a row this exact artefact has failed. */
export function strikesFor(url: string, variant?: PfpVariant): number {
  return failures.get(keyFor(url, variant))?.strikes ?? 0
}

/** True when enough of the backoff has passed to be worth asking the origin again. */
function dueForRetry(key: string): boolean {
  const failure = failures.get(key)
  if (failure === undefined) return true
  const wait = RETRY_BACKOFF_MS[Math.min(failure.strikes, RETRY_BACKOFF_MS.length) - 1] ?? 0
  return Date.now() - failure.at > wait
}

function noteFailure(key: string): void {
  // Bounded: an attacker feeding us dead URLs must not be able to grow.
  if (failures.size > 5_000) failures.clear()
  failures.set(key, { at: Date.now(), strikes: (failures.get(key)?.strikes ?? 0) + 1 })
}

function noteSuccess(key: string): void {
  failures.delete(key)
}

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
])

export interface CachedImage {
  bytes: Buffer
  type: string
  /** True when it came off disk rather than from the origin. */
  hit: boolean
}

/** The cache key. */
export function keyFor(url: string, variant?: PfpVariant): string {
  const subject = variant === undefined ? url : `w${variant}\u0000${url}`
  return createHash('sha256').update(subject).digest('hex')
}

// Sharded two levels deep: a single directory with a hundred thousand files is slow.
const pathFor = (key: string): string => join(ROOT, key.slice(0, 2), key.slice(2, 4), key)

/** Is this address safe for OUR server to fetch. */
async function safeToFetch(raw: string): Promise<boolean> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (isPrivateUrl(raw)) return false
  // `.onion` and friends: no exit route from this box, and nothing good at the end.
  if (/\.onion$/i.test(url.hostname)) return false

  try {
    const addresses = await lookup(url.hostname, { all: true })
    if (addresses.length === 0) return false
    return addresses.every(({ address }) => !isPrivateAddress(address))
  } catch {
    return false
  }
}

/** Loopback, RFC 1918, link-local, carrier-grade NAT, and the IPv6 equivalents. */
function isPrivateAddress(address: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }
  const v6 = address.toLowerCase()
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe80:/.test(v6)
}

async function readStored(key: string): Promise<CachedImage | null> {
  try {
    const file = pathFor(key)
    const info = await stat(file)
    if (Date.now() - info.mtimeMs > MAX_AGE_MS) return null
    const bytes = await readFile(file)
    const type = await readFile(`${file}.type`, 'utf8').catch(() => 'image/jpeg')
    return { bytes, type: type.trim(), hit: true }
  } catch {
    return null
  }
}

async function store(key: string, bytes: Buffer, type: string): Promise<void> {
  const file = pathFor(key)
  await mkdir(join(ROOT, key.slice(0, 2), key.slice(2, 4)), { recursive: true })
  await writeFile(file, bytes)
  await writeFile(`${file}.type`, type)
  if (Math.floor(Math.random() * SWEEP_ODDS) === 0) void sweep()
}

/** Fetch it ourselves, following redirects by hand. */
async function fromOrigin(raw: string): Promise<CachedImage | null> {
  let target = raw
  for (let hop = 0; hop < 3; hop += 1) {
    if (!(await safeToFetch(target))) return null
    /* THE BODY IS INSIDE THE TRY, and it took a 1.3 MB avatar to notice. */
    let buffer: Buffer
    let type: string
    try {
      const response = await fetch(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
        headers: { accept: 'image/*' },
      })
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location')
        if (next === null) return null
        target = new URL(next, target).toString()
        continue
      }
      if (!response.ok) return null

      type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
      if (!ALLOWED_TYPES.has(type)) return null
      const declared = Number(response.headers.get('content-length') ?? '0')
      if (declared > MAX_BYTES) return null
      buffer = Buffer.from(await response.arrayBuffer())
    } catch {
      return null
    }
    // Checked again after reading: `content-length` is a claim, not a guarantee.
    if (buffer.length === 0 || buffer.length > MAX_BYTES) return null
    return { bytes: buffer, type, hit: false }
  }
  return null
}

/** ── SHRINKING, and why it is not "processing user media". */
const MAX_FRAMES = 100

/** Past this, an animated thumbnail is not worth what it costs the reader. */
const ANIMATION_BUDGET = 150 * 1024

/** WebP: the only format that is both universally supported and animated. */
const VARIANT_TYPE = 'image/webp'

/** sharp, loaded lazily and allowed to be absent. */
let sharpModule: typeof import('sharp') | null | undefined

async function loadSharp(): Promise<typeof import('sharp') | null> {
  if (sharpModule !== undefined) return sharpModule
  try {
    const loaded = (await import('sharp')).default
    loaded.concurrency(1)
    sharpModule = loaded
  } catch {
    sharpModule = null
  }
  return sharpModule
}

/** A square thumbnail, or null if these bytes are not an image we can decode. */
async function shrink(bytes: Buffer, variant: PfpVariant): Promise<CachedImage | null> {
  const sharp = await loadSharp()
  if (sharp === null) return null
  const encode = async (animated: boolean): Promise<Buffer> =>
    sharp(bytes, { animated })
      // `cover`, because an avatar is drawn in a circle and a letterboxed face is worse.
      .resize(variant, variant, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer()

  try {
    const pages = (await sharp(bytes, { animated: true }).metadata()).pages ?? 1
    if (pages <= 1 || pages > MAX_FRAMES) {
      return { bytes: await encode(false), type: VARIANT_TYPE, hit: false }
    }
    const moving = await encode(true)
    // The still costs 4ms and is only reached for the handful of pictures that blew.
    const out = moving.length <= ANIMATION_BUDGET ? moving : await encode(false)
    return { bytes: out, type: VARIANT_TYPE, hit: false }
  } catch {
    return null
  }
}

/** One shrink, and one fetch, per key at a time. */
const shrinking = new Map<string, Promise<CachedImage | null>>()
const warming = new Map<string, Promise<void>>()

function once<T>(map: Map<string, Promise<T>>, key: string, work: () => Promise<T>): Promise<T> {
  const running = map.get(key)
  if (running !== undefined) return running
  const started = work().finally(() => map.delete(key))
  map.set(key, started)
  return started
}

/** What we already hold for this url, WITHOUT going to the network. */
export async function storedImage(url: string, variant?: PfpVariant): Promise<CachedImage | null> {
  const key = keyFor(url, variant)
  const fresh = await readStored(key)
  if (fresh !== null) return fresh

  const stale = await readStale(key)
  if (stale !== null) {
    /* Served, and refreshed behind the reader. */
    void warm(url, variant)
    return stale
  }
  if (variant === undefined) return null

  // Tried and failed recently.
  if (!dueForRetry(key)) return null
  const original = (await readStored(keyFor(url))) ?? (await readStale(keyFor(url)))
  if (original === null) return null
  return once(shrinking, key, async () => {
    const small = await shrink(original.bytes, variant)
    if (small === null) {
      noteFailure(key)
      return null
    }
    await store(key, small.bytes, small.type)
    noteSuccess(key)
    return { ...small, hit: true }
  })
}

/** Fetch and store, for a url we did. */
export async function warm(url: string, variant?: PfpVariant): Promise<void> {
  const key = keyFor(url, variant)
  if (!dueForRetry(key)) return
  /* THIS FUNCTION MUST NEVER REJECT. */
  return once(warming, key, async () => {
    try {
      await fetchAndStore(url, variant, key)
    } catch {
      noteFailure(key)
    }
  })
}

async function fetchAndStore(
  url: string,
  variant: PfpVariant | undefined,
  key: string,
): Promise<void> {
  if ((await readStored(key)) !== null) return

  const original = (await readStored(keyFor(url))) ?? (await fromOrigin(url))
  if (original === null) {
    noteFailure(key)
    return
  }
  // The full-size copy is stored too, even when a thumbnail is what was asked.
  if (!original.hit) await store(keyFor(url), original.bytes, original.type)
  if (variant === undefined) {
    noteSuccess(key)
    return
  }

  const small = await shrink(original.bytes, variant)
  if (small === null) {
    noteFailure(key)
    return
  }
  await store(key, small.bytes, small.type)
  noteSuccess(key)
}

/** True when this address is one we are willing to send a reader. */
export async function redirectable(url: string): Promise<boolean> {
  return safeToFetch(url)
}

/** Past its refresh age, but real. */
async function readStale(key: string): Promise<CachedImage | null> {
  try {
    const file = pathFor(key)
    const bytes = await readFile(file)
    const type = await readFile(`${file}.type`, 'utf8').catch(() => 'image/jpeg')
    return { bytes, type: type.trim(), hit: true }
  } catch {
    return null
  }
}

/** Drop entries nobody has asked for in a month. */
export async function sweep(): Promise<number> {
  let removed = 0
  const cutoff = Date.now() - SWEEP_AFTER_MS
  try {
    for (const outer of await readdir(ROOT)) {
      for (const inner of await readdir(join(ROOT, outer)).catch(() => [])) {
        const dir = join(ROOT, outer, inner)
        for (const name of await readdir(dir).catch(() => [])) {
          const file = join(dir, name)
          const info = await stat(file).catch(() => null)
          if (info !== null && info.mtimeMs < cutoff) {
            await unlink(file).catch(() => undefined)
            removed += 1
          }
        }
      }
    }
  } catch {
    // A cache that cannot be swept is a disk-space problem, not a request-time one.
  }
  return removed
}
