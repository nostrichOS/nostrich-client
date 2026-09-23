import { describe, expect, it } from 'vitest'

import { imageTokenValid, proxiedImageUrl, signImageUrl } from './image-token'

/** The signature that stops `/api/og-image` being an open proxy. */

const IMAGE = 'https://example.com/a/picture.png'

describe('signImageUrl', () => {
  it('accepts the URL it signed', () => {
    expect(imageTokenValid(IMAGE, signImageUrl(IMAGE))).toBe(true)
  })

  it('is deterministic, or a card would lose its picture on the next request', () => {
    expect(signImageUrl(IMAGE)).toBe(signImageUrl(IMAGE))
  })

  it('refuses a token minted for a different URL', () => {
    // The attack: take the token from a legitimate card and point it at your own host.
    const stolen = signImageUrl(IMAGE)
    expect(imageTokenValid('https://evil.example/payload.bin', stolen)).toBe(false)
  })

  it('is not fooled by URLs that differ in one character', () => {
    const token = signImageUrl(IMAGE)
    for (const near of [
      'https://example.com/a/picture.pn',
      'https://example.com/a/picture.png ',
      'https://example.com/a/picture.png?',
      'http://example.com/a/picture.png',
      'https://example.co/a/picture.png',
      'https://example.com//a/picture.png',
    ]) {
      expect(imageTokenValid(near, token)).toBe(false)
    }
  })

  it('produces a fixed-width token that gives nothing away', () => {
    const short = signImageUrl('https://a.example/1.png')
    const long = signImageUrl(`https://a.example/${'x'.repeat(3000)}.png`)
    expect(short).toHaveLength(32)
    expect(long).toHaveLength(32)
    expect(short).not.toBe(long)
    // base64url: safe to put in a query string without escaping, which is where it goes.
    expect(short).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('imageTokenValid', () => {
  it('refuses an empty or missing token rather than throwing', () => {
    // `timingSafeEqual` throws on a length mismatch, so the length check has to come first.
    for (const token of ['', ' ', 'x', 'a'.repeat(31), 'a'.repeat(33), 'a'.repeat(64)]) {
      expect(imageTokenValid(IMAGE, token)).toBe(false)
    }
  })

  it('refuses a token with one character changed', () => {
    const token = signImageUrl(IMAGE)
    const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1)
    expect(imageTokenValid(IMAGE, flipped)).toBe(false)
  })

  it('refuses a multi-byte token of the same visual length', () => {
    // Buffer length is bytes, not characters.
    expect(() => imageTokenValid(IMAGE, '🔑'.repeat(8))).not.toThrow()
    expect(imageTokenValid(IMAGE, '🔑'.repeat(8))).toBe(false)
  })
})

describe('proxiedImageUrl', () => {
  it('carries the URL and a matching signature', () => {
    const proxied = proxiedImageUrl(IMAGE)
    const params = new URLSearchParams(proxied.slice(proxied.indexOf('?') + 1))
    expect(params.get('u')).toBe(IMAGE)
    expect(imageTokenValid(params.get('u') ?? '', params.get('s') ?? '')).toBe(true)
  })

  it('escapes a URL whose own query would otherwise split the parameters', () => {
    // `?w=800&h=600` inside the image URL must not become two parameters of ours.
    const tricky = 'https://cdn.example/img.jpg?w=800&h=600&s=forged'
    const proxied = proxiedImageUrl(tricky)
    const params = new URLSearchParams(proxied.slice(proxied.indexOf('?') + 1))
    expect(params.get('u')).toBe(tricky)
    expect(params.getAll('s')).toHaveLength(1)
    expect(imageTokenValid(tricky, params.get('s') ?? '')).toBe(true)
  })
})
