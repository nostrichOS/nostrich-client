import { describe, expect, it } from 'vitest'

import { profileHandle } from './profile'

/** The @handle line, and the one thing it must never do: print a key where a name goes. */
describe('profileHandle', () => {
  it('prefers the name the account chose', () => {
    expect(profileHandle({ name: 'jack', nip05: 'jb55@jb55.com' })).toBe('jack')
  })

  it('trims, because a trailing space in metadata is somebody else’s bug', () => {
    expect(profileHandle({ name: '  jack  ' })).toBe('jack')
  })

  it('falls back to the readable half of a NIP-05 address', () => {
    expect(profileHandle({ nip05: 'alice@nostr.blue' })).toBe('alice')
  })

  /** Verification is the badge's job. */
  it('uses the local part whether or not the address verifies', () => {
    expect(profileHandle({ nip05: 'nobody@example.invalid' })).toBe('nobody')
  })

  it('uses the domain for the `_@domain` form, since "@_" is nonsense', () => {
    expect(profileHandle({ nip05: '_@nostrich.org' })).toBe('nostrich.org')
  })

  it('gives nothing when there is nothing, the caller owns the last resort', () => {
    expect(profileHandle({})).toBeUndefined()
    expect(profileHandle(null)).toBeUndefined()
    expect(profileHandle(undefined)).toBeUndefined()
    expect(profileHandle({ name: '   ', nip05: '  ' })).toBeUndefined()
  })

  it('never returns a key', () => {
    for (const profile of [{}, { name: '' }, { nip05: '@' }]) {
      expect(profileHandle(profile) ?? '').not.toMatch(/^npub1/)
    }
  })
})
