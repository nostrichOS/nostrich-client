import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import { profileBaseFor, shouldOffer } from './zap-address'

/** The read that decides whether a lightning address may be written into a profile. */

const ME = 'a'.repeat(64)

function metadata(at: number, content: string): NostrEvent {
  return { id: 'x'.repeat(64), pubkey: ME, kind: 0, created_at: at, content, tags: [], sig: 'f'.repeat(128) } as NostrEvent
}

describe('when nobody answered', () => {
  it('refuses, however empty the result looks', () => {
    const base = profileBaseFor(0, [])
    expect(base.ok).toBe(false)
    if (!base.ok) expect(base.message).toMatch(/relays/i)
  })

  it('refuses even if some events arrived from a relay that did not report answering', () => {
    // Belt and braces: the count is the fact being trusted, not the array length.
    expect(profileBaseFor(0, [metadata(10, '{"name":"me"}')]).ok).toBe(false)
  })
})

describe('when relays answered', () => {
  it('refuses when there is genuinely no profile, that is the editor’s job, not a wallet prompt', () => {
    const base = profileBaseFor(3, [])
    expect(base.ok).toBe(false)
    if (!base.ok) expect(base.message).toMatch(/Edit profile/i)
  })

  it('takes the newest, and hands back the whole profile to write on top of', () => {
    const base = profileBaseFor(3, [
      metadata(100, '{"name":"old"}'),
      metadata(200, '{"name":"me","picture":"https://example/a.png","about":"hi"}'),
    ])
    expect(base.ok).toBe(true)
    if (!base.ok) return
    expect(base.previousAt).toBe(200)
    // Everything survives: the address is added to this, not published instead.
    expect(base.content).toEqual({ name: 'me', picture: 'https://example/a.png', about: 'hi' })
  })

  it('refuses a profile it cannot parse rather than replacing it with a guess', () => {
    expect(profileBaseFor(3, [metadata(100, 'not json')]).ok).toBe(false)
    expect(profileBaseFor(3, [metadata(100, '["an","array"]')]).ok).toBe(false)
  })
})

/** Whether to interrupt somebody about where their zaps land. */
const NONE: readonly string[] = []

const base = {
  hasIdentity: true,
  walletAddress: 'examplewallet@wallet.example',
  currentAddress: 'zap@nostrich.org',
  destination: 'different' as const,
  dismissed: NONE,
  applied: NONE,
  done: false,
}

describe('shouldOffer', () => {
  it('stays quiet when two different strings reach the same wallet', () => {
    expect(shouldOffer({ ...base, destination: 'same' })).toBe(false)
  })

  it('offers when they genuinely reach different wallets', () => {
    expect(shouldOffer(base)).toBe(true)
  })

  it('waits rather than flashing while the lookup is in flight', () => {
    expect(shouldOffer({ ...base, destination: 'pending' })).toBe(false)
  })

  it('offers when the provider cannot be reached, a missed warning costs more than a spare one', () => {
    expect(shouldOffer({ ...base, destination: 'unknown' })).toBe(true)
  })

  it('stays quiet when the addresses are literally the same, whatever the case', () => {
    expect(
      shouldOffer({ ...base, currentAddress: 'ExampleWallet@Wallet.Example', destination: 'unknown' }),
    ).toBe(false)
  })

  it('needs a key that can sign the change', () => {
    expect(shouldOffer({ ...base, hasIdentity: false })).toBe(false)
  })

  it('respects a dismissal and an address already applied', () => {
    expect(shouldOffer({ ...base, dismissed: ['examplewallet@wallet.example'] })).toBe(false)
    expect(shouldOffer({ ...base, applied: ['examplewallet@wallet.example'] })).toBe(false)
  })

  it('says nothing when the wallet carries no address at all', () => {
    expect(shouldOffer({ ...base, walletAddress: undefined })).toBe(false)
    expect(shouldOffer({ ...base, walletAddress: '   ' })).toBe(false)
  })

  it('still offers to a profile with no address yet', () => {
    expect(shouldOffer({ ...base, currentAddress: undefined, destination: 'different' })).toBe(true)
  })
})
