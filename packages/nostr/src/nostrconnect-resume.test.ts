import { describe, expect, it } from 'vitest'
import { generateSecretKey } from 'nostr-tools/pure'
import { bytesToHex } from '@noble/hashes/utils'

import { createNostrConnectInvite } from './signers/nip46'
import type { RelayUrl } from './types'

/** A REBUILT INVITE MUST BE THE SAME INVITE. */

const RELAYS = ['wss://relay-a.example'] as RelayUrl[]

const make = (resume?: { clientSecretKey: string; secret: string; since: number }) =>
  createNostrConnectInvite({ relays: RELAYS, name: 'Nostrich', ...(resume === undefined ? {} : { resume }) })

describe('createNostrConnectInvite resume', () => {
  it('rebuilds the identical URI from a stored record', () => {
    const first = make()
    first.cancel()
    const again = make({
      clientSecretKey: first.clientSecretKey,
      secret: first.secret,
      since: first.createdAt,
    })
    again.cancel()

    // The URI carries the pubkey and the secret, which is the whole of what the signer.
    expect(again.uri).toBe(first.uri)
    expect(again.clientPublicKey).toBe(first.clientPublicKey)
    expect(again.secret).toBe(first.secret)
  })

  it('mints a different invite when there is nothing to resume', () => {
    const a = make()
    const b = make()
    a.cancel()
    b.cancel()
    expect(b.clientPublicKey).not.toBe(a.clientPublicKey)
    expect(b.secret).not.toBe(a.secret)
  })

  it('keeps the invite creation time, so the relay is asked far enough back', () => {
    // The default is a minute ago, which would skip an answer published while the app.
    const since = 1_700_000_000
    const invite = make({ clientSecretKey: bytesToHex(generateSecretKey()), secret: 'abc', since })
    invite.cancel()
    expect(invite.createdAt).toBe(since)
  })

  it('starts fresh rather than throwing on a corrupt stored key', () => {
    // A stored blob can be truncated or hand-edited, and 32 bytes of hex.
    for (const bad of ['', 'nothex', 'ab', 'f'.repeat(64), '0'.repeat(64)]) {
      const invite = make({ clientSecretKey: bad, secret: 'abc', since: 1 })
      invite.cancel()
      expect(invite.clientPublicKey).toMatch(/^[0-9a-f]{64}$/)
      expect(invite.secret).not.toBe('abc')
    }
  })

  it('exposes the transport key as hex, matching what a resumed session already stores', () => {
    const invite = make()
    invite.cancel()
    expect(invite.clientSecretKey).toMatch(/^[0-9a-f]{64}$/)
  })
})
