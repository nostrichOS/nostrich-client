import { describe, expect, it } from 'vitest'
import { PrivateKeySigner, encodeNsec, generateKeyPair } from '@nostrich/nostr'

import { persistableForm } from '../components/SessionProvider'

/** What survives a save, and what silently does. */
const { secretKey: secret, publicKey: pubkey } = generateKeyPair()
const signer = PrivateKeySigner.fromSecretKey(secret)
const session = { status: 'signed', pubkey, signer } as never

describe('persistableForm', () => {
  it('stores a private-key account that carries its key', () => {
    const stored = persistableForm({ pubkey, session, nsec: encodeNsec(secret) } as never)
    expect(stored).toMatchObject({ kind: 'privatekey', pubkey })
  })

  it('prefers the ENCRYPTED form when the reader set a password', () => {
    const stored = persistableForm({
      pubkey,
      session,
      nsec: encodeNsec(secret),
      ncryptsec: 'ncryptsec1example',
    } as never)
    expect(stored).toMatchObject({ kind: 'ncryptsec' })
  })

  it('REFUSES a private-key account with no key, this is the trap', () => {
    // Not a bug in this function: an account that cannot be reconstructed must.
    expect(persistableForm({ pubkey, session } as never)).toBeNull()
  })

  it('stores a read-only account, which needs no key at all', () => {
    const stored = persistableForm({ pubkey, session: { status: 'readonly', pubkey } } as never)
    expect(stored).toMatchObject({ kind: 'readonly', pubkey })
  })
})
