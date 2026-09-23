import { isPrivateHostname } from '@nostrich/nostr'

import { proxiedImageUrl } from '../../../lib/server/image-token'
import { isBareHost, looksLikeChallenge } from '../../../lib/server/unfurl-guards'
import { checkUrl, safeUrl } from '../../../lib/server/safe-fetch'

/** Open Graph metadata for one link, so a note can show a preview card. */

const MAX_REDIRECTS = 3
/** The whole request's budget, and the DIRECT fetch's share. */
const TIMEOUT_MS = 12_000
const DIRECT_TIMEOUT_MS = 5_000
/** Enough for any real `<head>`. */
const MAX_BYTES = 256 * 1024

/** Cached hard: the metadata behind a link does not change on the timescale. */
const CACHE_SECONDS = 60 * 60 * 6
/** A failure is about this minute, not about the page. */
const EMPTY_CACHE_SECONDS = 10 * 60

export interface Unfurled {
  url: string
  title?: string
  description?: string
  /** Ours: `/api/og-image?u=…&s=…`. */
  image?: string
  /** The publisher's own image URL, as a FALLBACK for the card. */
  imageDirect?: string
  siteName?: string
}

/** Read at most MAX_BYTES, and stop early once the head is closed. */
async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const decoder = new TextDecoder()
  let html = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || value === undefined) break
      bytes += value.byteLength
      html += decoder.decode(value, { stream: true })
      if (bytes >= MAX_BYTES || /<\/head>/i.test(html)) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return html
}

function meta(html: string, patterns: string[]): string | undefined {
  for (const name of patterns) {
    // Attribute order is not fixed in the wild, so both arrangements are tried.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const re of [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
    ]) {
      const found = re.exec(html)?.[1]?.trim()
      if (found !== undefined && found !== '') return decodeEntities(found)
    }
  }
  return undefined
}

/** HTML entities in an OG tag, decoded. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) => fromCodePoint(parseInt(hex, 16), whole))
    .replace(/&#(\d+);/g, (whole, digits: string) => fromCodePoint(Number(digits), whole))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** A code point, or the entity untouched if it is not one. */
function fromCodePoint(code: number, fallback: string): string {
  if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return fallback
  try {
    return String.fromCodePoint(code)
  } catch {
    return fallback
  }
}

/** Providers that answer oEmbed, which is the correct question to ask them. */
const OEMBED: { match: RegExp; endpoint: (url: string) => string }[] = [
  {
    match: /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)$/i,
    endpoint: url => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  },
  {
    match: /^(?:www\.)?vimeo\.com$/i,
    endpoint: url => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
  },
]

interface OembedBody {
  title?: unknown
  author_name?: unknown
  thumbnail_url?: unknown
  provider_name?: unknown
}

async function viaOembed(url: URL, signal: AbortSignal): Promise<Unfurled | undefined> {
  const provider = OEMBED.find(candidate => candidate.match.test(url.hostname))
  if (provider === undefined) return undefined
  try {
    const response = await fetch(provider.endpoint(url.toString()), { signal })
    if (!response.ok) return undefined
    const body = (await response.json()) as OembedBody
    const title = typeof body.title === 'string' ? body.title : undefined
    if (title === undefined) return undefined
    return {
      url: url.toString(),
      title,
      ...pick('image', proxy(typeof body.thumbnail_url === 'string' ? body.thumbnail_url : undefined)),
      ...pick('imageDirect', typeof body.thumbnail_url === 'string' ? body.thumbnail_url : undefined),
      ...pick('siteName', typeof body.provider_name === 'string' ? body.provider_name : undefined),
      // The channel is what a reader actually wants to know about a video, and oEmbed.
      ...pick('description', typeof body.author_name === 'string' ? body.author_name : undefined),
    }
  } catch {
    return undefined
  }
}

export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url')
  if (target === null || target === '') {
    return Response.json({ error: 'url required' }, { status: 400 })
  }

  const verdict = await checkUrl(target)
  if (!verdict.ok) {
    /* A RESOLVER FAILURE IS NOT A VERDICT ABOUT THE URL. */
    if (verdict.reason === 'unresolved') {
      return Response.json(
        { error: 'could not resolve that host right now' },
        { status: 503, headers: cacheHeaders(true) },
      )
    }
    return Response.json({ error: 'unsupported url' }, { status: 400 })
  }
  let current = verdict.url

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // Asked first where it exists: it is authoritative, cheap, and does not require.
    const oembed = await viaOembed(current, controller.signal)
    if (oembed !== undefined) return Response.json(oembed, { headers: cacheHeaders() })

    let html = ''
    let finalUrl = current
    /** Its own deadline. */
    const direct = AbortSignal.any([controller.signal, AbortSignal.timeout(DIRECT_TIMEOUT_MS)])
    let unsafeRedirect = false

    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const response = await fetch(current, {
          // Manual, so every hop is re-checked.
          redirect: 'manual',
          signal: direct,
          headers: {
            // Some sites serve OG tags only to things that look like a crawler.
            'user-agent': 'Mozilla/5.0 (compatible; NostrichBot/1.0; +https://nostrich.org)',
            accept: 'text/html,application/xhtml+xml',
          },
        })

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (location === null) break
          const next = await safeUrl(new URL(location, current).toString())
          if (next === null) {
            unsafeRedirect = true
            break
          }
          current = next
          finalUrl = next
          continue
        }

        const type = response.headers.get('content-type') ?? ''
        // An image or a PDF has no OG tags, and reading one would be pure waste.
        if (!type.includes('html')) break
        if (!response.ok) break
        html = await readHead(response)
        /* A WALL IS NOT THE PAGE, even when it answers 200 with a perfectly good title. */
        if (looksLikeChallenge(html, titleTag(html))) html = ''
        break
      }
    } catch {
      // Refused, stalled or aborted.
    }

    if (unsafeRedirect) return Response.json({ error: 'unsafe redirect' }, { status: 400 })

    const parsedTitle = meta(html, ['og:title', 'twitter:title']) ?? titleTag(html)
    const chosenImage = await firstLiveImage(html, finalUrl, controller.signal)
    const result: Unfurled = {
      url: finalUrl.toString(),
      ...pick('title', isBareHost(parsedTitle, finalUrl) ? undefined : parsedTitle),
      ...pick('description', meta(html, ['og:description', 'twitter:description', 'description'])),
      // Signed and pointed at our own proxy, so a reader's browser never touches.
      ...pick('image', chosenImage?.ours === true ? proxy(chosenImage.url) : undefined),
      ...pick('imageDirect', chosenImage?.url),
      ...pick('siteName', meta(html, ['og:site_name'])),
    }

    if (result.title === undefined && result.image === undefined) {
      /* The site would not talk to US, specifically. */
      const relayed = await viaReader(current, controller.signal)
      if (relayed !== undefined) return Response.json(relayed, { headers: cacheHeaders() })
      // Nothing worth drawing a card.
      return Response.json({ url: result.url }, { headers: cacheHeaders(true) })
    }
    return Response.json(result, { headers: cacheHeaders() })
  } catch {
    // A slow, dead or hostile site is not an error the reader needs to see.
    return Response.json({ url: target }, { headers: cacheHeaders(true) })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The fallback fetcher, for the minority of pages that refuse this server's address.
 *
 * Set UNFURL_READER_URL to a reader service that takes the target URL appended to it and
 * returns the page. It is OFF unless you set it, because it sends the link to a third party.
 * That party learns which links get posted here. No reader is exposed, since the call is made
 * by the server, and page contents are public anyway.
 */
const READER_ENDPOINT = process.env['UNFURL_READER_URL'] ?? ''
const READER_TIMEOUT_MS = 8_000

/** Every image a page offers, best first. */
function imageCandidates(html: string): (string | undefined)[] {
  return [
    meta(html, ['og:image']),
    meta(html, ['og:image:secure_url', 'og:image:url']),
    meta(html, ['twitter:image', 'twitter:image:src']),
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1],
  ]
}

/** How long one candidate gets to prove it exists before the next is tried. */
const IMAGE_CHECK_MS = 3_000

/** The first advertised image that is actually there. */
interface ImageChoice {
  url: string
  /** Whether THIS SERVER could fetch. */
  ours: boolean
}

async function firstLiveImage(html: string, base: URL, signal: AbortSignal): Promise<ImageChoice | undefined> {
  const seen = new Set<string>()
  /** The best candidate that was never DISPROVED, as opposed to the best that answered. */
  let unproven: ImageChoice | undefined

  for (const candidate of imageCandidates(html)) {
    const url = absolute(candidate, base)
    if (url === undefined || seen.has(url)) continue
    seen.add(url)

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.any([signal, AbortSignal.timeout(IMAGE_CHECK_MS)]),
      })
      // A refused METHOD says nothing about the file.
      if (response.status === 405 || response.status === 501) return { url, ours: true }
      if (response.ok) {
        const type = response.headers.get('content-type') ?? ''
        if (type === '' || type.startsWith('image/')) return { url, ours: true }
      }
      /* GONE versus REFUSED, and the difference decides everything. */
      if (response.status === 404 || response.status === 410) continue
      unproven ??= { url, ours: false }
    } catch {
      // Timed out or refused the connection.
      unproven ??= { url, ours: false }
    }
  }

  return unproven
}

async function viaReader(target: URL, signal: AbortSignal): Promise<Unfurled | undefined> {
  if (READER_ENDPOINT === '') return undefined
  try {
    const response = await fetch(`${READER_ENDPOINT}${target.toString()}`, {
      // Its own deadline as well as the request's: a reader service having a slow minute.
      signal: AbortSignal.any([signal, AbortSignal.timeout(READER_TIMEOUT_MS)]),
      /* HTML, not markdown. */
      headers: { accept: 'text/html', 'x-respond-with': 'html' },
      // Cached by Next for the same six hours the response is, so a link that many readers.
      next: { revalidate: CACHE_SECONDS },
    })
    if (!response.ok) return undefined

    const html = await readHead(response)
    /* The reader hit the same wall we did. */
    if (/requiring CAPTCHA|Just a moment|Access Denied/i.test(html.slice(0, 1200))) return undefined
    const title = meta(html, ['og:title', 'twitter:title']) ?? titleTag(html)
    if (looksLikeChallenge(html, title)) return undefined

    const chosen = await firstLiveImage(html, target, signal)
    const clean = isBareHost(title, target) ? undefined : title
    if (clean === undefined && chosen === undefined) return undefined

    return {
      url: target.toString(),
      ...pick('title', clean),
      ...pick('description', meta(html, ['og:description', 'twitter:description', 'description'])),
      ...pick('image', chosen?.ours === true ? proxy(chosen.url) : undefined),
      ...pick('imageDirect', chosen?.url),
      ...pick('siteName', meta(html, ['og:site_name']) ?? target.hostname.replace(/^www\./, '')),
    }
  } catch {
    // Slow, rate-limited or down.
    return undefined
  }
}

/** Every image we hand out goes through our own proxy. */
function proxy(url: string | undefined): string | undefined {
  return url === undefined || url === '' ? undefined : proxiedImageUrl(url)
}

function pick(key: string, value: string | undefined): Record<string, string> {
  return value === undefined || value === '' ? {} : { [key]: value }
}

function titleTag(html: string): string | undefined {
  const found = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim()
  return found === undefined || found === '' ? undefined : decodeEntities(found)
}

/** OG images are frequently relative, and a relative URL is useless to the browser here. */
function absolute(value: string | undefined, base: URL): string | undefined {
  if (value === undefined) return undefined
  try {
    const resolved = new URL(value, base)
    // The reader's browser will fetch this directly.
    if (isPrivateHostname(resolved.hostname)) return undefined
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return undefined
    /** Upgraded to https before it is handed out. */
    resolved.protocol = 'https:'
    return resolved.toString()
  } catch {
    return undefined
  }
}

/** How long an answer keeps, and why an EMPTY one keeps for much less. */
function cacheHeaders(empty = false): Record<string, string> {
  const seconds = empty ? EMPTY_CACHE_SECONDS : CACHE_SECONDS
  return {
    'cache-control': `public, max-age=${seconds}`,
  }
}
