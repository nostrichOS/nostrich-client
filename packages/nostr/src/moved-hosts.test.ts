import { describe, expect, it } from 'vitest'

import { MOVED_MEDIA_HOSTS, repairMediaUrl, secureMediaUrl } from './moved-hosts'

/** The guarantees that make a host substitution safe to do silently. */
describe('repairMediaUrl', () => {
  it('substitutes the host of a known migration', () => {
    expect(repairMediaUrl('https://heyframe.com/images/img.php/bitcoin-page34.png')).toBe(
      'https://frameterminal.com/images/img.php/bitcoin-page34.png',
    )
  })

  it('carries the path, query and fragment across untouched', () => {
    expect(repairMediaUrl('https://heyframe.com/a/b%20c.png?v=7&w=800#frag')).toBe(
      'https://frameterminal.com/a/b%20c.png?v=7&w=800#frag',
    )
  })

  it('handles the www form and is case-insensitive about the host', () => {
    expect(repairMediaUrl('https://WWW.HeyFrame.com/x.png')).toBe('https://frameterminal.com/x.png')
  })

  it('leaves every other host alone', () => {
    for (const url of [
      'https://cdn-a.example/abc.png',
      'https://example.com/heyframe.com/x.png',
      'https://notheyframe.com/x.png',
      'https://heyframe.com.evil.test/x.png',
    ]) {
      expect(repairMediaUrl(url)).toBe(url)
    }
  })

  /** A suffix match would rewrite anybody who registered `<anything>heyframe.com`. */
  it('does not match a host that merely ends with a moved one', () => {
    expect(repairMediaUrl('https://myheyframe.com/x.png')).toBe('https://myheyframe.com/x.png')
  })

  /** REVERSED, deliberately. */
  it('upgrades http rather than leaving a plaintext fetch on the page', () => {
    expect(repairMediaUrl('http://example.com/x.png')).toBe('https://example.com/x.png')
  })

  it('returns anything unparseable exactly as given', () => {
    for (const url of ['', 'not a url', 'https://', 'data:image/png;base64,AAAA']) {
      expect(repairMediaUrl(url)).toBe(url)
    }
  })

  it('drops a port that belonged to the old host', () => {
    expect(repairMediaUrl('https://heyframe.com:8443/x.png')).toBe('https://frameterminal.com/x.png')
  })
})

describe('the map itself', () => {
  it('stays short enough to read in one go', () => {
    // Not a limit for its own sake: this list is only defensible while a person can audit.
    expect(MOVED_MEDIA_HOSTS.length).toBeLessThanOrEqual(10)
  })

  it('never maps a host to itself or to another entry source', () => {
    const sources = new Set(MOVED_MEDIA_HOSTS.map(moved => moved.from))
    for (const moved of MOVED_MEDIA_HOSTS) {
      expect(moved.from).not.toBe(moved.to)
      // A chain would make the result depend on iteration order.
      expect(sources.has(moved.to)).toBe(false)
      expect(moved.note.trim()).not.toBe('')
    }
  })
})

/** The scheme upgrade. */
describe('secureMediaUrl', () => {
  it('upgrades a plaintext media url', () => {
    expect(secureMediaUrl('http://cdn-b.example/a.mp4')).toBe(
      'https://cdn-b.example/a.mp4',
    )
  })

  it('leaves an https url alone', () => {
    expect(secureMediaUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })

  it('keeps the path, query and fragment exactly', () => {
    expect(secureMediaUrl('http://h.example/a/b.mp4?t=3#x')).toBe('https://h.example/a/b.mp4?t=3#x')
  })

  /** Only the scheme moves. */
  it('does not touch anything that is not http', () => {
    expect(secureMediaUrl('ipfs://cid')).toBe('ipfs://cid')
    expect(secureMediaUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
  })

  it('upgrades before the host map runs, so a moved host on http is still repaired', () => {
    // repairMediaUrl early-returned on non-https before this, so an http URL skipped.
    const moved = MOVED_MEDIA_HOSTS[0]
    if (moved === undefined) return
    expect(repairMediaUrl(`http://${moved.from}/x.jpg`)).toBe(`https://${moved.to}/x.jpg`)
  })
})
