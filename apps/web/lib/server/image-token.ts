import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** The signature that stops the image proxy being an open proxy. */

const secret = process.env.UNFURL_PROXY_SECRET ?? randomBytes(32).toString('hex')

export function signImageUrl(url: string): string {
  return createHmac('sha256', secret).update(url).digest('base64url').slice(0, 32)
}

export function imageTokenValid(url: string, token: string): boolean {
  const expected = Buffer.from(signImageUrl(url))
  const given = Buffer.from(token)
  // Length first: `timingSafeEqual` throws on a mismatch rather than returning false.
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** The URL a card should use for an image: ours, carrying theirs. */
export function proxiedImageUrl(url: string): string {
  return `/api/og-image?u=${encodeURIComponent(url)}&s=${signImageUrl(url)}`
}
