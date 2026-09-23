import { describe, expect, it } from 'vitest'

import { SIGNER_PERMS } from './signer-perms'

/** What we ask a remote signer for, once, at pairing time. */
describe('SIGNER_PERMS', () => {
  it('asks for the mute list', () => {
    // Added AHEAD of the code that publishes it, deliberately.
    expect(SIGNER_PERMS).toContain('sign_event:10000')
  })

  it('asks for the kinds without which a whole feature is dead', () => {
    const required = [
      'sign_event:13', // NIP-17 seal, without it DMs cannot be sent at all
      'sign_event:9734', // zap request, without it every zap prompts
      'sign_event:24242', // Blossom upload auth, without it attaching a photo prompts
      // NIP-22 comment.
      'sign_event:1111',
      'nip44_encrypt',
      'nip44_decrypt',
    ]
    for (const perm of required) expect(SIGNER_PERMS, perm).toContain(perm)
  })

  it('never asks to WRITE nip04', () => {
    // packages/nostr/src/types.ts is explicit that NIP-04 is supported for reading old.
    expect(SIGNER_PERMS).not.toContain('nip04_encrypt')
    expect(SIGNER_PERMS).toContain('nip04_decrypt')
  })

  it('has no duplicates', () => {
    expect(new Set(SIGNER_PERMS).size).toBe(SIGNER_PERMS.length)
  })
})
