import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DM_RELAYS,
  DEFAULT_RELAY_ENTRIES,
  DEFAULT_SIGNER_RELAYS,
  signerRelays,
} from './relays'

/** A RELAY THIS APP DECLARES READ-ONLY IS NEVER WRITTEN. */

const writable = new Set(
  DEFAULT_RELAY_ENTRIES.filter(entry => entry.policy.write).map(entry => entry.url),
)
const readOnly = DEFAULT_RELAY_ENTRIES.filter(entry => !entry.policy.write).map(entry => entry.url)

describe('relay sets that a stranger must be able to write to', () => {
  /** PROVE THE FILTER, not the shipping list. */
  it('never derives a signer relay from a read-only entry', () => {
    const entries = [
      { url: 'wss://writable.example' as never, policy: { read: true, write: true } },
      { url: 'wss://readonly.example' as never, policy: { read: true, write: false } },
    ]
    const derived = entries.filter(entry => entry.policy.write).map(entry => entry.url)
    expect(derived).toEqual(['wss://writable.example'])
    expect(derived).not.toContain('wss://readonly.example')
  })

  it('still declares every default relay writable-or-not explicitly', () => {
    // The policy must be stated for each, whichever way it points.
    for (const entry of DEFAULT_RELAY_ENTRIES) expect(typeof entry.policy.write).toBe('boolean')
  })

  it('never offers a READ-ONLY relay to a remote signer', () => {
    /* The rule is about relays this app has DECLARED read-only, not about membership. */
    for (const url of DEFAULT_SIGNER_RELAYS) expect(readOnly).not.toContain(url)
  })

  it('never offers a read-only relay for DMs, the same requirement, same reason', () => {
    // A gift wrap is signed by a throwaway key, which is a stranger exactly as a signer.
    for (const url of DEFAULT_DM_RELAYS) expect(readOnly).not.toContain(url)
  })

  it('leaves the signer set non-empty', () => {
    expect(DEFAULT_SIGNER_RELAYS.length).toBeGreaterThan(0)
  })
})

describe('signerRelays', () => {
  it('strips a read-only relay out of a pairing that was already stored', () => {
    // Every pairing made before this existed carries one.
    const held = readOnly[0] as string
    expect(signerRelays([held, 'wss://nos.lol'])).not.toContain(held)
  })

  it('keeps a relay the signer chose that we know nothing about', () => {
    // A `bunker://` URI names the signer's own relays, and those are not ours.
    expect(signerRelays(['wss://relay.nsec.app'])).toContain('wss://relay.nsec.app')
  })

  it('adds the current defaults, because we can only listen where we are told', () => {
    const out = signerRelays([])
    for (const url of DEFAULT_SIGNER_RELAYS) expect(out).toContain(url)
  })

  it('does not repeat a relay that is already in the stored set', () => {
    const out = signerRelays(['wss://nos.lol'])
    expect(out.filter(url => url === 'wss://nos.lol')).toHaveLength(1)
  })

  it('drops anything that is not a usable relay URL', () => {
    expect(signerRelays(['not a url', ''])).toEqual([...DEFAULT_SIGNER_RELAYS])
  })
})
