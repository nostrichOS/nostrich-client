import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RelayUrl } from '@nostrich/nostr'

import { fetchRelayInfo, forgetRelayInfo, refusesStrangers } from './relay-info'

/** Reading a relay's own NIP-11 document, for one question: will it take a write. */

const RELAY = 'wss://relay.example' as RelayUrl

const respond = (body: unknown, ok = true): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  )
}

beforeEach(() => {
  forgetRelayInfo()
  vi.unstubAllGlobals()
})

describe('fetchRelayInfo', () => {
  it('reads the three limitations that decide whether a stranger can write', async () => {
    respond({
      name: 'a paid relay',
      limitation: { payment_required: true, auth_required: false, restricted_writes: true },
    })
    expect(await fetchRelayInfo(RELAY)).toEqual({
      name: 'a paid relay',
      paymentRequired: true,
      authRequired: false,
      restrictedWrites: true,
    })
  })

  it('treats a document with no limitation block as open', async () => {
    respond({ name: 'nos.lol' })
    const info = await fetchRelayInfo(RELAY)
    expect(info && refusesStrangers(info)).toBe(false)
  })

  it('does not read a non-boolean as true', async () => {
    // A relay answering `"payment_required": "no"` must not be reported as paid.
    respond({ limitation: { payment_required: 'no', restricted_writes: 1 } })
    const info = await fetchRelayInfo(RELAY)
    expect(info && refusesStrangers(info)).toBe(false)
  })

  it('says "unknown" rather than throwing when the relay cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('CORS') }))
    await expect(fetchRelayInfo(RELAY)).resolves.toBeUndefined()
  })

  it('says "unknown" for an HTTP error and for a body that is not an object', async () => {
    respond({}, false)
    expect(await fetchRelayInfo(RELAY)).toBeUndefined()
    forgetRelayInfo()
    respond('<html>not json</html>')
    expect(await fetchRelayInfo(RELAY)).toBeUndefined()
  })

  it('remembers a failure so an unreachable relay is not re-fetched on every render', async () => {
    const failing = vi.fn(async () => { throw new Error('down') })
    vi.stubGlobal('fetch', failing)
    await fetchRelayInfo(RELAY)
    await fetchRelayInfo(RELAY)
    expect(failing).toHaveBeenCalledTimes(1)
  })
})

describe('refusesStrangers', () => {
  it('flags each limitation on its own', () => {
    const base = { paymentRequired: false, authRequired: false, restrictedWrites: false }
    expect(refusesStrangers(base)).toBe(false)
    expect(refusesStrangers({ ...base, paymentRequired: true })).toBe(true)
    expect(refusesStrangers({ ...base, authRequired: true })).toBe(true)
    expect(refusesStrangers({ ...base, restrictedWrites: true })).toBe(true)
  })
})
