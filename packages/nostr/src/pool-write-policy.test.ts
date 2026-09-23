import { describe, expect, it } from 'vitest'

import { createPool } from './pool'
import type { Hex, NostrEvent, RelayUrl } from './types'

/** A RELAY MARKED READ-ONLY IS NEVER PUBLISHED. */

const READER = '1'.repeat(64) as Hex
const OPEN = 'wss://open.example' as RelayUrl
const READ_ONLY = 'wss://paid.example' as RelayUrl
const UNKNOWN = 'wss://someone-elses.example' as RelayUrl

const event = (): NostrEvent =>
  ({
    id: '0'.repeat(64),
    pubkey: READER,
    kind: 1,
    created_at: 1_700_000_000,
    content: 'hello',
    tags: [],
    sig: '',
  }) as NostrEvent

function pool() {
  const p = createPool()
  p.setRelays([
    { url: OPEN, policy: { read: true, write: true } },
    { url: READ_ONLY, policy: { read: true, write: false } },
  ])
  return p
}

describe('publish respects the write policy', () => {
  it('skips a read-only relay even when the caller names it explicitly', async () => {
    // The whole bug: an explicit list used to bypass the policy entirely.
    const results = await pool().publish(event(), [OPEN, READ_ONLY])
    expect(results.map(r => r.relay)).not.toContain(READ_ONLY)
  })

  it('skips it when the caller names no relays at all', async () => {
    const results = await pool().publish(event())
    expect(results.map(r => r.relay)).not.toContain(READ_ONLY)
  })

  it('still publishes to the writable relay beside it', async () => {
    const results = await pool().publish(event(), [OPEN, READ_ONLY])
    expect(results.map(r => r.relay)).toContain(OPEN)
  })

  it('passes through a relay it has no policy for', async () => {
    // A wallet's NWC relay or a bunker's own relay is not the reader's read/write choice.
    const results = await pool().publish(event(), [UNKNOWN])
    expect(results.map(r => r.relay)).toContain(UNKNOWN)
  })

  it('publishes nowhere rather than somewhere forbidden', async () => {
    const results = await pool().publish(event(), [READ_ONLY])
    expect(results).toEqual([])
  })
})
