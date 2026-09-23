import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '@noble/hashes/utils'

import { decryptNcryptsec, encryptToNcryptsec } from './nip49'
import { InvalidKeyError } from './keys'

/** The one form in which this app will write a private key down. */

const PASSPHRASE = 'correct horse battery staple'

describe('encryptToNcryptsec', () => {
  it('round-trips a key through the passphrase', () => {
    const secret = generateSecretKey()
    const backup = encryptToNcryptsec(secret, PASSPHRASE)

    expect(backup.startsWith('ncryptsec1')).toBe(true)
    const restored = decryptNcryptsec(backup, PASSPHRASE)
    expect(bytesToHex(restored)).toBe(bytesToHex(secret))
    // The identity is what actually has to survive, not the bytes as such.
    expect(getPublicKey(restored)).toBe(getPublicKey(secret))
  })

  it('never produces the same ciphertext twice for one key', () => {
    // A fresh salt and nonce per call.
    const secret = generateSecretKey()
    const a = encryptToNcryptsec(secret, PASSPHRASE)
    const b = encryptToNcryptsec(secret, PASSPHRASE)
    expect(a).not.toBe(b)
    expect(bytesToHex(decryptNcryptsec(a, PASSPHRASE))).toBe(bytesToHex(decryptNcryptsec(b, PASSPHRASE)))
  })

  it('refuses to encrypt without a passphrase', () => {
    // An empty passphrase produces a string that LOOKS protected.
    expect(() => encryptToNcryptsec(generateSecretKey(), '')).toThrow(InvalidKeyError)
  })

  it('refuses anything that is not a 32-byte key', () => {
    expect(() => encryptToNcryptsec(new Uint8Array(31), PASSPHRASE)).toThrow(InvalidKeyError)
    expect(() => encryptToNcryptsec(new Uint8Array(33), PASSPHRASE)).toThrow(InvalidKeyError)
    expect(() => encryptToNcryptsec(new Uint8Array(0), PASSPHRASE)).toThrow(InvalidKeyError)
  })

  it('accepts a passphrase with spaces, case and unicode in it', () => {
    const secret = generateSecretKey()
    for (const phrase of ['  leading and trailing  ', 'CaseSensitive', 'pässwörd 🔑', 'x']) {
      const backup = encryptToNcryptsec(secret, phrase)
      expect(bytesToHex(decryptNcryptsec(backup, phrase))).toBe(bytesToHex(secret))
    }
  })

  it('does not trim or case-fold the passphrase', () => {
    // The passphrase is bytes the user typed.
    const secret = generateSecretKey()
    const backup = encryptToNcryptsec(secret, '  Spaced Phrase  ')
    expect(() => decryptNcryptsec(backup, 'Spaced Phrase')).toThrow(InvalidKeyError)
    expect(() => decryptNcryptsec(backup, '  spaced phrase  ')).toThrow(InvalidKeyError)
    expect(bytesToHex(decryptNcryptsec(backup, '  Spaced Phrase  '))).toBe(bytesToHex(secret))
  })
})

describe('decryptNcryptsec', () => {
  it('refuses the wrong passphrase', () => {
    const backup = encryptToNcryptsec(generateSecretKey(), PASSPHRASE)
    expect(() => decryptNcryptsec(backup, 'not the passphrase')).toThrow(InvalidKeyError)
  })

  it('refuses a damaged backup', () => {
    const backup = encryptToNcryptsec(generateSecretKey(), PASSPHRASE)
    // One character of the DATA changed, deterministically: 'q' and 'p'.
    const at = 20
    const swapped = backup[at] === 'q' ? 'p' : 'q'
    const broken = backup.slice(0, at) + swapped + backup.slice(at + 1)
    expect(broken).not.toBe(backup)
    expect(() => decryptNcryptsec(broken, PASSPHRASE)).toThrow(InvalidKeyError)
  })

  it('refuses anything that is not an ncryptsec at all', () => {
    for (const input of ['', 'nsec1abc', 'npub1abc', 'hello', 'ncryptsec', '  ']) {
      expect(() => decryptNcryptsec(input, PASSPHRASE)).toThrow(InvalidKeyError)
    }
  })

  it('tolerates the whitespace a paste brings with it', () => {
    const secret = generateSecretKey()
    const backup = encryptToNcryptsec(secret, PASSPHRASE)
    expect(bytesToHex(decryptNcryptsec(`  ${backup}\n`, PASSPHRASE))).toBe(bytesToHex(secret))
  })

  it('says the likely thing without claiming to know which it was', () => {
    // A bad passphrase and a corrupt payload are indistinguishable from outside.
    const backup = encryptToNcryptsec(generateSecretKey(), PASSPHRASE)
    expect(() => decryptNcryptsec(backup, 'wrong')).toThrow(/wrong passphrase, or the backup is damaged/)
  })
})
