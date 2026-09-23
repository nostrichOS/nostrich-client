import { describe, expect, it } from 'vitest'

import { DEFAULT_RELAYS, ZAP_RELAYS } from './relays'
import { isRelayUrl, normalizeRelayUrl } from './relays'

/** The extra relays consulted for zap receipts. */
describe('ZAP_RELAYS', () => {
  it('adds reach rather than duplicating what we already read', () => {
    for (const url of ZAP_RELAYS) expect(DEFAULT_RELAYS).not.toContain(url)
  })

  it('is a real, normalised relay list', () => {
    expect(ZAP_RELAYS.length).toBeGreaterThan(0)
    for (const url of ZAP_RELAYS) {
      expect(isRelayUrl(url)).toBe(true)
      // Already in the form the pool normalises to, so merging cannot produce two legs.
      expect(normalizeRelayUrl(url)).toBe(url)
    }
  })

  it('carries the relay that closed the measured gap', () => {
    // The 21-sat receipt existed only here and on primus.nostr1.com.
    expect(ZAP_RELAYS).toContain('wss://nostr-pub.wellorder.net')
  })

  it('stays small, this is a supplement, not a second relay set', () => {
    // Four to five on 2026-09-04, and paid for rather than simply widened: `nostr.land`.
    expect(ZAP_RELAYS.length).toBeLessThanOrEqual(4)
  })

  it('does not carry a relay measured to return nothing', () => {
    expect(ZAP_RELAYS).not.toContain('wss://nostr.land')
  })

  it('does not carry a relay that has stopped answering', () => {
    // Down since 2026-09-02. A relay that HANGS costs the pool's whole connect timeout.
    expect(ZAP_RELAYS).not.toContain('wss://relay.nostr.band')
  })

  it('does not carry a personal relay added to rescue one receipt', () => {
    // `nostr.data.haus` held the only copy of one 42-sat receipt and one unique receipt.
    expect(ZAP_RELAYS).not.toContain('wss://nostr.data.haus')
  })
})
