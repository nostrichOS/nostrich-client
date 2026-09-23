import { imageTokenValid } from '../../../lib/server/image-token'
import { safeUrl } from '../../../lib/server/safe-fetch'

/** One link-preview picture, fetched by this server and streamed to the reader. */

const MAX_BYTES = 8 * 1024 * 1024

/** A small hot cache of card images, in this process's memory. */
const HOT_MAX_ENTRIES = 48
const HOT_MAX_BYTES = 512 * 1024
const hot = new Map<string, { body: Uint8Array; type: string }>()

function hotGet(key: string): { body: Uint8Array; type: string } | undefined {
  const held = hot.get(key)
  if (held === undefined) return undefined
  // Re-inserted, so the most recently used entry is the last one out.
  hot.delete(key)
  hot.set(key, held)
  return held
}

function hotPut(key: string, value: { body: Uint8Array; type: string }): void {
  if (value.body.byteLength > HOT_MAX_BYTES) return
  hot.set(key, value)
  while (hot.size > HOT_MAX_ENTRIES) {
    const oldest = hot.keys().next().value
    if (oldest === undefined) break
    hot.delete(oldest)
  }
}

/** The headers every image answer carries, hot or cold. */
function imageHeaders(type: string): Record<string, string> {
  return {
    'content-type': type,
    'cache-control': `public, max-age=${CACHE_SECONDS}`,
    // The bytes are a picture and nothing else.
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    // The reader asked us for this, not the publisher: no referrer goes anywhere.
    'referrer-policy': 'no-referrer',
  }
}
/** Long enough for a publisher that transcodes on demand. */
const TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3
const CACHE_SECONDS = 60 * 60 * 24

/** Anything that is an image, SVG included. */
function renderable(type: string): boolean {
  return type.startsWith('image/')
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const target = params.get('u')
  const token = params.get('s')

  if (target === null || token === null) {
    return new Response('missing url or signature', { status: 400 })
  }
  if (!imageTokenValid(target, token)) {
    // Deliberately terse: a caller poking at this learns nothing about why it failed.
    return new Response('forbidden', { status: 403 })
  }

  const held = hotGet(target)
  if (held !== undefined) {
    return new Response(held.body as unknown as BodyInit, { headers: imageHeaders(held.type) })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    let current = await safeUrl(target)
    if (current === null) return new Response('unsafe url', { status: 400 })

    let response: Response | undefined
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await fetch(current, {
        // Manual, so each hop is re-checked.
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          // The publisher's own page, because that is what a hotlink check looks.
          referer: `${current.origin}/`,
          'user-agent': 'Mozilla/5.0 (compatible; NostrichBot/1.0; +https://nostrich.org)',
        },
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (location === null) break
        const next = await safeUrl(new URL(location, current).toString())
        if (next === null) return new Response('unsafe redirect', { status: 400 })
        current = next
        continue
      }
      break
    }

    if (response === undefined || !response.ok || response.body === null) {
      return new Response('upstream refused', { status: 502 })
    }

    const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!renderable(type)) return new Response('not an image', { status: 415 })

    const declared = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return new Response('too large', { status: 413 })
    }

    /* A SMALL image is read into memory, kept, and answered from there next time. */
    if (Number.isFinite(declared) && declared > 0 && declared <= HOT_MAX_BYTES) {
      const body = new Uint8Array(await response.arrayBuffer())
      if (body.byteLength > MAX_BYTES) return new Response('too large', { status: 413 })
      hotPut(target, { body, type })
      return new Response(body as unknown as BodyInit, { headers: imageHeaders(type) })
    }

    /* Streamed, and counted on the way past. */
    let seen = 0
    const capped = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, sink) {
          seen += chunk.byteLength
          if (seen > MAX_BYTES) {
            sink.error(new Error('image exceeded the size cap'))
            return
          }
          sink.enqueue(chunk)
        },
      }),
    )

    return new Response(capped, { headers: imageHeaders(type) })
  } catch {
    // Slow, dead or hostile.
    return new Response('unreachable', { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}
