import { describe, expect, it } from 'vitest'

import { isPrivateHostname, isPrivateUrl } from './relays'

/** A note's URLs are attacker-controlled. */
describe('isPrivateHostname', () => {
  it('catches loopback, link-local and every RFC 1918 range', () => {
    for (const host of [
      'localhost', 'app.localhost', 'umbrel.local', '127.0.0.1', '127.1.2.3', '0.0.0.0',
      '10.0.0.1', '10.255.255.255', '192.168.1.1', '172.16.0.1', '172.31.255.1',
      '169.254.169.254', '::1', '[::1]', 'fd00::1', 'fe80::1',
    ]) {
      expect(isPrivateHostname(host), host).toBe(true)
    }
  })

  it('leaves public hosts alone', () => {
    for (const host of [
      'nostrich.org', 'relay-a.example', 'cdn-a.example', 'example-client.test',
      // Near misses that are genuinely public.
      '172.32.0.1', '11.0.0.1', '10.example.com', 'notlocalhost.com', 'local.example.com',
    ]) {
      expect(isPrivateHostname(host), host).toBe(false)
    }
  })
})

describe('isPrivateUrl', () => {
  it('judges by hostname', () => {
    expect(isPrivateUrl('http://192.168.1.5/photo.jpg')).toBe(true)
    expect(isPrivateUrl('https://umbrel.local/lnurlp/bob')).toBe(true)
    expect(isPrivateUrl('https://nostr.build/i/abc.png')).toBe(false)
  })

  it('treats an unparseable URL as private rather than as safe', () => {
    // Fail closed: a string we cannot understand is not a string we should fetch.
    expect(isPrivateUrl('not a url')).toBe(true)
    expect(isPrivateUrl('')).toBe(true)
  })
})
