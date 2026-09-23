import { describe, expect, it } from 'vitest'

import { blossomOperator, uploadServers } from './blossom'

/** Uploads used to go to our three defaults and nowhere else, however loudly. */
const DEFAULTS = [
  'https://blossom.nostr.build',
  'https://cdn.hzrd149.com',
  'https://cdn.nostrcheck.me',
]

describe('blossomOperator', () => {
  it('knows blossom.band and blossom.nostr.build are one service', () => {
    expect(blossomOperator('https://blossom.band')).toBe(blossomOperator('https://blossom.nostr.build'))
  })

  it('treats a personal blossom.band subdomain as the same service', () => {
    // The commonest shape of "my own server", and the one that would silently break.
    expect(blossomOperator('https://birobela.blossom.band')).toBe('nostr.build')
  })

  it('assumes an unknown host is its own operator', () => {
    expect(blossomOperator('https://cdn.hzrd149.com')).toBe('cdn.hzrd149.com')
    expect(blossomOperator('https://media.example.org')).toBe('media.example.org')
  })

  it('does not care about a trailing slash or a missing scheme', () => {
    expect(blossomOperator('blossom.band/')).toBe('nostr.build')
  })
})

describe('uploadServers', () => {
  it('puts the author’s own server first', () => {
    const servers = uploadServers(['https://birobela.blossom.band'], DEFAULTS)
    expect(servers[0]).toBe('https://birobela.blossom.band')
  })

  it('keeps ours behind them, so a dead personal server still posts the picture', () => {
    const servers = uploadServers(['https://birobela.blossom.band'], DEFAULTS)
    expect(servers).toContain('https://cdn.hzrd149.com')
  })

  it('makes the SECOND server a second operator', () => {
    // birobela.blossom.band and blossom.nostr.build are one backend.
    const servers = uploadServers(['https://birobela.blossom.band'], DEFAULTS)
    expect(blossomOperator(servers[1]!)).not.toBe(blossomOperator(servers[0]!))
  })

  it('leaves our own order alone when the author has published nothing', () => {
    expect(uploadServers([], DEFAULTS)).toEqual(DEFAULTS)
  })

  it('never sends the same server twice', () => {
    const servers = uploadServers(['https://cdn.hzrd149.com', 'https://cdn.hzrd149.com/'], DEFAULTS)
    expect(new Set(servers).size).toBe(servers.length)
  })

  it('accepts a bare hostname the way the rest of Blossom does', () => {
    expect(uploadServers(['birobela.blossom.band'], DEFAULTS)[0]).toBe('https://birobela.blossom.band')
  })

  it('bounds the walk however many servers an author lists', () => {
    const many = ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', 'https://e.example']
    expect(uploadServers(many, DEFAULTS).length).toBeLessThanOrEqual(4)
  })

  it('leaves the order alone when every server is one operator', () => {
    const servers = uploadServers(['https://birobela.blossom.band'], ['https://blossom.band'])
    expect(servers).toEqual(['https://birobela.blossom.band', 'https://blossom.band'])
  })

  it('ignores blank entries rather than uploading to https://', () => {
    expect(uploadServers(['', '   '], DEFAULTS)).toEqual(DEFAULTS)
  })
})
