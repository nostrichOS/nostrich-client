import { beforeEach, describe, expect, it } from 'vitest'

import { announceProblem, announceZapFailure, announceZapWarning, currentOutcome, currentZapOutcome, dismissOutcome, dismissZapOutcome } from './outcome'

/** The zap dialog closes on the press and sends behind it, which is the whole speed win. */

beforeEach(dismissZapOutcome)

describe('zap outcomes', () => {
  it('says nothing at all when there is nothing to say', () => {
    expect(currentZapOutcome()).toBeUndefined()
  })

  it('carries a failure as an error', () => {
    announceZapFailure('No route to the recipient.')
    expect(currentZapOutcome()).toMatchObject({
      message: 'No route to the recipient.',
      tone: 'error',
    })
  })

  it('carries a paid-but-caveated zap as a warning, which reads differently', () => {
    // This one WAS paid.
    announceZapWarning('Sent, but their server did not confirm it as a zap.')
    expect(currentZapOutcome()?.tone).toBe('warning')
  })

  it('gives two identical failures distinct ids, so the second one re-shows', () => {
    announceZapFailure('No route to the recipient.')
    const first = currentZapOutcome()?.id
    announceZapFailure('No route to the recipient.')
    expect(currentZapOutcome()?.id).not.toBe(first)
  })

  it('replaces the previous outcome rather than queueing behind it', () => {
    announceZapFailure('first')
    announceZapWarning('second')
    expect(currentZapOutcome()?.message).toBe('second')
  })

  it('clears on dismiss', () => {
    announceZapFailure('gone in a moment')
    dismissZapOutcome()
    expect(currentZapOutcome()).toBeUndefined()
  })
})

describe('the channel is no longer zaps only', () => {
  /** Remote signing is the second thing in this app that can fail invisibly. */
  it('carries a problem that has nothing to do with a zap', () => {
    announceProblem('Your signer did not answer. Open it to approve, then come back.')
    expect(currentOutcome()?.message).toContain('Your signer did not answer')
    expect(currentOutcome()?.tone).toBe('error')
    dismissOutcome()
  })

  it('still answers to the names money uses', () => {
    // `announceZapFailure` reads better than `announceProblem` at a payment call site.
    announceZapFailure('No route to the recipient.')
    expect(currentOutcome()?.message).toBe('No route to the recipient.')
    dismissOutcome()
  })

  it('holds one at a time, so the newer thing is the one on screen', () => {
    announceProblem('first')
    announceProblem('second')
    expect(currentOutcome()?.message).toBe('second')
    dismissOutcome()
  })
})
