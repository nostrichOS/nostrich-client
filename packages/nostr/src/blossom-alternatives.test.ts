import { describe, expect, it } from 'vitest'

import { blossomAlternatives } from './blossom'

const SERVERS = ['https://blossom.nostr.build', 'https://cdn-a.example']
const HASH = 'fb9b35347c39f9842a6141749e98e4e9ff8c070f1705a373c01762e3640ae434'

describe('blossomAlternatives', () => {
  it('offers the same hash on the other server', () => {
    expect(blossomAlternatives(`https://cdn-a.example/${HASH}.jpg`, SERVERS)[0]).toBe(
      `https://blossom.nostr.build/${HASH}.jpg`,
    )
  })

  it('never offers back the host that just failed', () => {
    const out = blossomAlternatives(`https://blossom.nostr.build/${HASH}.jpg`, SERVERS)
    expect(out.some(url => url.includes('nostr.build'))).toBe(false)
  })

  it('carries the extension over, because some hosts 404 the bare hash', () => {
    expect(blossomAlternatives(`https://cdn-a.example/${HASH}.png`, SERVERS)[0]).toMatch(/\.png$/)
  })

  it('works for a bare hash with no extension', () => {
    expect(blossomAlternatives(`https://cdn-a.example/${HASH}`, SERVERS)).toContain(
      `https://blossom.nostr.build/${HASH}`,
    )
  })

  it('offers every other server when there are three', () => {
    const three = [...SERVERS, 'https://cdn.satellite.earth']
    expect(blossomAlternatives(`https://cdn-a.example/${HASH}.jpg`, three)).toHaveLength(2)
  })

  it('refuses anything not hash-addressed, there is no honest fallback', () => {
    expect(blossomAlternatives('https://media.example/PGrs.jpg', SERVERS)).toEqual([])
    expect(blossomAlternatives('https://image.nostr.build/holiday.png', SERVERS)).toEqual([])
    // 63 hex characters is not a sha256.
    expect(blossomAlternatives(`https://cdn-a.example/${HASH.slice(1)}.jpg`, SERVERS)).toEqual([])
  })

  it('survives a URL that is not a URL', () => {
    expect(blossomAlternatives('not a url', SERVERS)).toEqual([])
    expect(blossomAlternatives('', SERVERS)).toEqual([])
  })

  it('is case-insensitive about the hash but emits it lowercase', () => {
    expect(blossomAlternatives(`https://cdn-a.example/${HASH.toUpperCase()}.JPG`, SERVERS)[0]).toContain(HASH)
  })

  it('tolerates a server entry with a trailing slash', () => {
    expect(
      blossomAlternatives(`https://cdn-a.example/${HASH}.jpg`, ['https://blossom.nostr.build/']),
    ).toContain(`https://blossom.nostr.build/${HASH}.jpg`)
  })
})
