import { describe, expect, it } from 'vitest'

import { tryNormalizeRelayUrl } from './relays'

describe('malformed relay urls from other people lists', () => {
  /** A relay list is a stranger's untrusted input and it ends in a websocket. */
  it('rejects a scheme typed with one slash', () => {
    // `https:/azzamo.media` fails the `://` scheme test, gets prefixed, and parses.
    expect(tryNormalizeRelayUrl('https:/azzamo.media')).toBeUndefined()
  })

  it('rejects a bare word with no domain', () => {
    expect(tryNormalizeRelayUrl('relay')).toBeUndefined()
    expect(tryNormalizeRelayUrl('wss://relay')).toBeUndefined()
  })

  it('still accepts localhost, the one legitimate dotless host', () => {
    expect(tryNormalizeRelayUrl('localhost:7777')).toBe('ws://localhost:7777')
  })

  it('still accepts an ordinary relay and an https one', () => {
    expect(tryNormalizeRelayUrl('wss://relay.example.com')).toBe('wss://relay.example.com')
    expect(tryNormalizeRelayUrl('https://azzamo.media')).toBe('wss://azzamo.media')
  })
})
