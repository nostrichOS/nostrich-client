import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  Nip07MissingCapabilityError,
  Nip07RejectedError,
  Nip07Signer,
  type Nip07Provider,
} from './nip07'

/** The extension is asked, not trusted. */

const CIPHERTEXT = 'AkVLQV3jZ1ZbdCJfMbFhQzZ8Q0Y1bWJqSjJtQmFPQVpZTjBWWmxLTFdlN0d2QzhLZlZoQXBRPT0='
const PEER = 'b'.repeat(64)

function install(provider: Partial<Nip07Provider>): Nip07Signer {
  vi.stubGlobal('window', { nostr: provider })
  return new Nip07Signer()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('nip44Encrypt', () => {
  it('refuses an empty answer instead of passing it on as ciphertext', async () => {
    const signer = install({ nip44: { encrypt: async () => '', decrypt: async () => 'x' } })
    await expect(signer.nip44Encrypt(PEER, 'private')).rejects.toBeInstanceOf(Nip07RejectedError)
  })

  it('refuses whitespace, which is empty wearing a disguise', async () => {
    const signer = install({ nip44: { encrypt: async () => '  \n ', decrypt: async () => 'x' } })
    await expect(signer.nip44Encrypt(PEER, 'private')).rejects.toThrow(/empty ciphertext/)
  })

  it('passes real ciphertext through untouched', async () => {
    const signer = install({ nip44: { encrypt: async () => CIPHERTEXT, decrypt: async () => 'x' } })
    await expect(signer.nip44Encrypt(PEER, 'private')).resolves.toBe(CIPHERTEXT)
  })

  it('still reports a missing capability as a missing capability', async () => {
    const signer = install({})
    await expect(signer.nip44Encrypt(PEER, 'private')).rejects.toBeInstanceOf(
      Nip07MissingCapabilityError,
    )
  })

  it('hands the extension the peer key it was given', async () => {
    const seen: string[] = []
    const signer = install({
      nip44: {
        encrypt: async (pubkey: string) => {
          seen.push(pubkey)
          return CIPHERTEXT
        },
        decrypt: async () => 'x',
      },
    })
    await signer.nip44Encrypt(PEER, 'private')
    expect(seen).toEqual([PEER])
  })
})

/** NIP-44 will not encrypt an empty plaintext at all, so an empty DECRYPTION is never. */
describe('decryption', () => {
  it('refuses an empty nip44 answer', async () => {
    const signer = install({ nip44: { encrypt: async () => CIPHERTEXT, decrypt: async () => '' } })
    await expect(signer.nip44Decrypt(PEER, CIPHERTEXT)).rejects.toThrow(/could not decrypt/)
  })

  it('refuses an empty nip04 answer', async () => {
    const signer = install({ nip04: { encrypt: async () => CIPHERTEXT, decrypt: async () => '' } })
    await expect(signer.nip04Decrypt(PEER, CIPHERTEXT)).rejects.toThrow(/could not decrypt/)
  })

  it('refuses an answer that is not a string at all', async () => {
    const signer = install({
      nip44: { encrypt: async () => CIPHERTEXT, decrypt: async () => undefined as unknown as string },
    })
    await expect(signer.nip44Decrypt(PEER, CIPHERTEXT)).rejects.toThrow(/could not decrypt/)
  })

  it('returns a real message', async () => {
    const signer = install({
      nip44: { encrypt: async () => CIPHERTEXT, decrypt: async () => 'meet me at the usual place' },
    })
    await expect(signer.nip44Decrypt(PEER, CIPHERTEXT)).resolves.toBe('meet me at the usual place')
  })
})
