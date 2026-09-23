import { describe, expect, it } from 'vitest'

import { closedReasonPrefix, isPermanentRefusal } from './closed-reason'

/** The real message that motivated this, verbatim from a paid relay, plus the cases. */

describe('closedReasonPrefix', () => {
  it('reads a NIP-01 prefix', () => {
    expect(closedReasonPrefix('restricted: not a paying member')).toBe('restricted')
  })

  it('tolerates the spacing and case relays actually use', () => {
    expect(closedReasonPrefix('Auth-Required:need to authenticate')).toBe('auth-required')
  })

  it('is not fooled by a URL in a transport message', () => {
    expect(closedReasonPrefix('wss://relay.example: connection lost')).toBeUndefined()
  })

  it('has no answer for a bare close', () => {
    expect(closedReasonPrefix('')).toBeUndefined()
    expect(closedReasonPrefix('connection closed')).toBeUndefined()
  })
})

describe('isPermanentRefusal', () => {
  it('stops on the message that caused 220 pointless REQs in forty seconds', () => {
    expect(
      isPermanentRefusal("auth-required: we can't serve DMs to unauthenticated users"),
    ).toBe(true)
  })

  it('stops on the other refusals a retry cannot change', () => {
    for (const reason of ['restricted: pay to read', 'blocked: you are banned', 'invalid: bad filter', 'unsupported: no such nip', 'pow: need 24 bits']) {
      expect(isPermanentRefusal(reason), reason).toBe(true)
    }
  })

  it('KEEPS RETRYING when the relay is only saying "not right now"', () => {
    // The whole point of the split: rate-limited is a refusal that later becomes a yes.
    expect(isPermanentRefusal('rate-limited: slow down')).toBe(false)
    expect(isPermanentRefusal('error: something went wrong')).toBe(false)
  })

  it('retries anything it does not recognise, including a dropped connection', () => {
    expect(isPermanentRefusal('')).toBe(false)
    expect(isPermanentRefusal('connection closed')).toBe(false)
    expect(isPermanentRefusal('shutting down: back in a minute')).toBe(false)
  })
})
