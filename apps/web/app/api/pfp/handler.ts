import { redirectable, storedImage, strikesFor, warm } from '../../../lib/pfp-cache'
import type { PfpVariant } from '../../../lib/pfp-variants'

/** An image, served from our own copy. */
export async function servePfp(request: Request, variant?: PfpVariant): Promise<Response> {
  const source = new URL(request.url).searchParams.get('u')
  if (source === null || source === '') return new Response('missing u', { status: 400 })
  if (source.length > 2_048) return new Response('url too long', { status: 400 })

  const held = await storedImage(source, variant)
  if (held !== null) return image(held.bytes, held.type)

  /* WE HAVE ASKED BEFORE AND IT DID NOT WORK. */
  const strikes = strikesFor(source, variant)
  if (strikes > 0) {
    // Still retried behind the reader, on the backoff in `pfp-cache`.
    void warm(source, variant)
    return deadEnd(strikes >= 3 ? 3600 : 300)
  }

  /* A FIRST MISS IS REDIRECTED AND FETCHED BEHIND THE READER. */
  // Only ever to an address that passed the same checks a fetch would.
  if (!(await redirectable(source))) return deadEnd(3600)
  void warm(source, variant)
  return new Response(null, {
    status: 302,
    headers: {
      location: source,
      // Never cached: the next request should find the warmed copy, not this redirect.
      'cache-control': 'no-store',
      'x-pfp-cache': 'miss',
    },
  })
}

/** "Load it yourself." The client drops us from the chain and goes to the origin. */
function deadEnd(seconds: number): Response {
  return new Response('not cached', {
    status: 404,
    headers: {
      'cache-control': `public, max-age=${seconds}`,
      'x-pfp-cache': 'dead',
    },
  })
}

function image(bytes: Buffer, type: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': type,
      'content-length': String(bytes.length),
      /* A YEAR, immutable. */
      'cache-control': 'public, max-age=31536000, immutable',
      'x-pfp-cache': 'hit',
      // Never let a stored SVG execute in our origin's context.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  })
}
