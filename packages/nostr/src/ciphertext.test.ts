import { describe, expect, it } from 'vitest'

import { isCiphertext, isSealed } from './ciphertext'

/** The guard that stands between a signer misbehaving and a reader's list being. */
describe('isCiphertext', () => {
  it('rejects the empty answer that caused the data loss', () => {
    expect(isCiphertext('')).toBe(false)
  })

  it('rejects whitespace, which is empty wearing a disguise', () => {
    expect(isCiphertext('   ')).toBe(false)
    expect(isCiphertext('\n')).toBe(false)
  })

  it('rejects a missing answer without throwing', () => {
    expect(isCiphertext(undefined)).toBe(false)
    expect(isCiphertext(null)).toBe(false)
  })

  /** Accepting real ciphertext is the half that stops the guard from being a denial. */
  it('accepts real ciphertext', () => {
    expect(
      isCiphertext('AkVLQV3jZ1ZbdCJfMbFhQzZ8Q0Y1bWJqSjJtQmFPQVpZTjBWWmxLTFdlN0d2QzhLZlZoQXBRPT0='),
    ).toBe(true)
  })

  /** NOT a format check. */
  it('does not second-guess the format', () => {
    expect(isCiphertext('x')).toBe(true)
  })
})

/** The stronger question, asked where a wrong answer is published rather than lost. */
describe('isSealed', () => {
  const RUMOR = JSON.stringify({ id: 'a'.repeat(64), content: 'meet me at the usual place' })

  it('rejects a signer that handed the message straight back', () => {
    expect(isSealed(RUMOR, RUMOR)).toBe(false)
  })

  it('rejects an answer that merely wrapped the message', () => {
    expect(isSealed(`encrypted(${RUMOR})`, RUMOR)).toBe(false)
  })

  it('rejects an answer the message contains, which is a truncated echo', () => {
    expect(isSealed('meet me at the usual place', RUMOR)).toBe(false)
  })

  it('rejects the empty answer, exactly as isCiphertext does', () => {
    expect(isSealed('', RUMOR)).toBe(false)
    expect(isSealed(undefined, RUMOR)).toBe(false)
  })

  it('accepts real ciphertext over the same plaintext', () => {
    expect(
      isSealed('AkVLQV3jZ1ZbdCJfMbFhQzZ8Q0Y1bWJqSjJtQmFPQVpZTjBWWmxLTFdlN0d2QzhLZlZoQXBRPT0=', RUMOR),
    ).toBe(true)
  })

  /** Still not a format check. */
  it('does not second-guess the format', () => {
    expect(isSealed('x', RUMOR)).toBe(true)
  })
})
