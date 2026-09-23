import { describe, expect, it, vi } from 'vitest'
import { ZAP_RELAYS } from '@nostrich/nostr'

const readRelays = vi.fn()
vi.mock('./pool', () => ({ getPool: () => ({ readRelays }) }))

const { zapRelays } = await import('./zap-relays')

describe('zapRelays', () => {
  it("asks this reader's own relays FIRST, then the extras", () => {
    readRelays.mockReturnValue(['wss://nos.lol', 'wss://relay-a.example'])
    const result = zapRelays()
    expect(result.slice(0, 2)).toEqual(['wss://nos.lol', 'wss://relay-a.example'])
    for (const url of ZAP_RELAYS) expect(result).toContain(url)
  })

  it('never names the same relay twice when the reader already added one', () => {
    readRelays.mockReturnValue(['wss://nos.lol', 'wss://nostr.land'])
    const result = zapRelays()
    expect(result.filter(url => url === 'wss://nostr.land')).toHaveLength(1)
  })

  it('is additive, it never drops a relay the reader chose', () => {
    const mine = ['wss://relay.example.com', 'wss://another.example']
    readRelays.mockReturnValue(mine)
    for (const url of mine) expect(zapRelays()).toContain(url)
  })

  it('still returns the extras when the reader has no relays at all', () => {
    readRelays.mockReturnValue([])
    expect(zapRelays()).toEqual([...ZAP_RELAYS])
  })
})
