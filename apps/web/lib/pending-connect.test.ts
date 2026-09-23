import { beforeEach, describe, expect, it } from 'vitest'

import {
  PENDING_TTL_MS,
  clearPendingConnect,
  readPendingConnect,
  writePendingConnect,
} from './pending-connect'

/** The record that lets a pairing survive the app being killed. */

const NOW = 1_800_000_000_000
const record = {
  clientSecretKey: 'a'.repeat(64),
  secret: 'b'.repeat(32),
  relays: ['wss://relay-a.example'],
  // Unix SECONDS, because it goes straight back into a relay filter's `since`.
  createdAt: Math.floor(NOW / 1000),
}

beforeEach(() => {
  localStorage.clear()
})

describe('pending connect', () => {
  it('round-trips the three fields the invite has to be rebuilt from', () => {
    // All three are useless apart: the key is the address AND the decryption key.
    writePendingConnect(record)
    expect(readPendingConnect(NOW)).toEqual(record)
  })

  it('is gone once the pairing window has passed', () => {
    writePendingConnect(record)
    expect(readPendingConnect(NOW + PENDING_TTL_MS + 1)).toBeUndefined()
  })

  it('clears an expired record rather than leaving it in storage', () => {
    writePendingConnect(record)
    readPendingConnect(NOW + PENDING_TTL_MS + 1)
    expect(localStorage.getItem('nostrich:pending-connect')).toBeNull()
  })

  it('survives right up to the edge of the window', () => {
    writePendingConnect(record)
    expect(readPendingConnect(NOW + PENDING_TTL_MS - 1)).toEqual(record)
  })

  it('reads nothing from corrupt or partial storage rather than throwing', () => {
    // This runs on the sign-in screen.
    localStorage.setItem('nostrich:pending-connect', '{ not json')
    expect(readPendingConnect(NOW)).toBeUndefined()
    localStorage.setItem('nostrich:pending-connect', JSON.stringify({ secret: 'x' }))
    expect(readPendingConnect(NOW)).toBeUndefined()
    localStorage.setItem('nostrich:pending-connect', JSON.stringify({ ...record, relays: [1, 2] }))
    expect(readPendingConnect(NOW)).toBeUndefined()
  })

  it('is cleared on success, because a paired invite is a dead address', () => {
    writePendingConnect(record)
    clearPendingConnect()
    expect(readPendingConnect(NOW)).toBeUndefined()
  })
})
