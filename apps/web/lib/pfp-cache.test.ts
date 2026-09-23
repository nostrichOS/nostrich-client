import { describe, expect, it } from 'vitest'

import { cachedPfp } from './blossom-retry'
import { keyFor } from './pfp-cache'
import { PFP_VARIANTS, isPfpVariant, pfpVariantPath } from './pfp-variants'

/** The cache key is the whole invalidation story. */
describe('profile cache key', () => {
  it('is stable for the same url', () => {
    expect(keyFor('https://host/a.png')).toBe(keyFor('https://host/a.png'))
  })

  it('changes when the picture changes, which IS the invalidation', () => {
    expect(keyFor('https://host/old.png')).not.toBe(keyFor('https://host/new.png'))
  })

  it('separates two hosts serving the same filename', () => {
    expect(keyFor('https://a.example/x.png')).not.toBe(keyFor('https://b.example/x.png'))
  })

  it('is a sha256, so it is safe as a path segment', () => {
    expect(keyFor('https://host/a.png')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('cachedPfp', () => {
  it('encodes the source so a query string in it cannot escape', () => {
    const url = 'https://host/a.png?w=200&h=200'
    expect(cachedPfp(url)).toBe(`/api/pfp?u=${encodeURIComponent(url)}`)
    // One parameter, not three.
    expect(new URL(cachedPfp(url), 'https://x').searchParams.get('u')).toBe(url)
  })

  it('survives a url with a hash fragment and unicode', () => {
    const url = 'https://host/ünïcode.png#frag'
    expect(new URL(cachedPfp(url), 'https://x').searchParams.get('u')).toBe(url)
  })
})

/** The relative-url trap. */
describe('our own cache urls are not third-party urls', () => {
  it('produces a root-relative path', () => {
    expect(cachedPfp('https://host/a.png').startsWith('/')).toBe(true)
  })

  it('is unparseable as an absolute url, which is why it must be exempt from the check', () => {
    expect(() => new URL(cachedPfp('https://host/a.png'))).toThrow()
  })

  it('resolves against our own origin, and only ours', () => {
    const resolved = new URL(cachedPfp('https://host/a.png'), 'https://nostrich.org')
    expect(resolved.origin).toBe('https://nostrich.org')
    expect(resolved.pathname).toBe('/api/pfp')
  })
})

/** Thumbnails, and the two properties that go quiet when they break. */
describe('thumbnail variants', () => {
  it('does not collide with the full-size copy of the same url', () => {
    expect(keyFor('https://host/a.png', 128)).not.toBe(keyFor('https://host/a.png'))
  })

  it('gives each rung its own key', () => {
    expect(keyFor('https://host/a.png', 128)).not.toBe(keyFor('https://host/a.png', 384))
  })

  it('is still a sha256, so it is still safe as a path segment', () => {
    expect(keyFor('https://host/a.png', 384)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts only the rungs on the ladder', () => {
    for (const width of PFP_VARIANTS) expect(isPfpVariant(width)).toBe(true)
    // An open size parameter would be an unbounded key space at our expense.
    for (const width of [0, 1, 127, 129, 256, 4096]) expect(isPfpVariant(width)).toBe(false)
  })
})

/** THE FILE EXTENSION IS LOAD-BEARING, which is exactly the kind of thing that gets. */
describe('the thumbnail path is cacheable at the edge', () => {
  it('ends in .webp', () => {
    for (const width of PFP_VARIANTS) expect(pfpVariantPath(width).endsWith('.webp')).toBe(true)
  })

  it('puts the width in the path and only the source in the query', () => {
    const url = 'https://host/a.png?w=200'
    const built = new URL(cachedPfp(url, 128), 'https://nostrich.org')
    expect(built.pathname).toBe('/api/pfp/128.webp')
    expect(built.searchParams.get('u')).toBe(url)
    expect([...built.searchParams.keys()]).toEqual(['u'])
  })

  it('leaves the full-size route alone, note media and banners still use it', () => {
    expect(new URL(cachedPfp('https://host/a.png'), 'https://x').pathname).toBe('/api/pfp')
  })
})
