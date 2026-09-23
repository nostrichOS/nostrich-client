import { decrypt as nip49Decrypt, encrypt as nip49Encrypt } from 'nostr-tools/nip49'

import { InvalidKeyError } from './keys'

/** NIP-49: a private key encrypted under a passphrase, as an `ncryptsec1…` string. */

/** scrypt work factor, as log2. NIP-49 allows 1..22. 16 is the spec's own suggestion. */
const LOG_N = 16

/** Key security byte 0x02: "the client does not know whether the key was ever handled. */
const SECURITY_UNKNOWN = 0x02

export function encryptToNcryptsec(secretKey: Uint8Array, passphrase: string): string {
  if (secretKey.length !== 32) {
    throw new InvalidKeyError(`secret key must be 32 bytes, got ${secretKey.length}`)
  }
  if (passphrase === '') {
    throw new InvalidKeyError('a passphrase is required to encrypt a key')
  }
  return nip49Encrypt(secretKey, passphrase, LOG_N, SECURITY_UNKNOWN)
}

/** Decrypt an `ncryptsec1…` back to 32 bytes. */
export function decryptNcryptsec(ncryptsec: string, passphrase: string): Uint8Array {
  const trimmed = ncryptsec.trim()
  if (!trimmed.startsWith('ncryptsec1')) {
    throw new InvalidKeyError('expected an ncryptsec1… string')
  }
  try {
    return nip49Decrypt(trimmed, passphrase)
  } catch {
    // The library throws on both a bad passphrase and a corrupt payload.
    throw new InvalidKeyError('wrong passphrase, or the backup is damaged')
  }
}
