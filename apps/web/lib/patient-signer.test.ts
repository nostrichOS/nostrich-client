import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventTemplate, NostrEvent, Signer } from '@nostrich/nostr'

import { patientSigner } from './patient-signer'
import { announceZapFailure, currentOutcome, dismissOutcome } from './outcome'

/** A slow signature has to explain itself. */

const NOTE: EventTemplate = { kind: 1, created_at: 1, tags: [], content: 'hi' }

function signerThatTakes(ms: number): Signer {
  return {
    kind: 'nip46',
    getPublicKey: async () => 'f'.repeat(64) as never,
    signEvent: (template: EventTemplate) =>
      new Promise<NostrEvent>(resolve => {
        setTimeout(() => resolve({ ...template, id: 'x', pubkey: 'f', sig: 's' } as NostrEvent), ms)
      }),
  } as unknown as Signer
}

afterEach(() => {
  dismissOutcome()
  vi.useRealTimers()
})

describe('patientSigner', () => {
  it('says nothing when the signer is awake', async () => {
    const signer = patientSigner(signerThatTakes(10))
    await signer.signEvent(NOTE)
    expect(currentOutcome()).toBeUndefined()
  })

  it('says "waiting" once the signer has gone quiet', async () => {
    vi.useFakeTimers()
    const signer = patientSigner(signerThatTakes(10_000))
    void signer.signEvent(NOTE)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(currentOutcome()?.message).toContain('Waiting for your signer')
  })

  it('withdraws it the moment the answer lands', async () => {
    // A toast still saying "waiting" over a like that has already landed is its own small.
    vi.useFakeTimers()
    const signer = patientSigner(signerThatTakes(4_000))
    const pending = signer.signEvent(NOTE)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(currentOutcome()?.message).toContain('Waiting')
    await vi.advanceTimersByTimeAsync(2_000)
    await pending
    expect(currentOutcome()).toBeUndefined()
  })

  it('leaves somebody else’s message alone', async () => {
    // A zap that failed while a signature was pending matters more than this notice.
    vi.useFakeTimers()
    const signer = patientSigner(signerThatTakes(4_000))
    const pending = signer.signEvent(NOTE)
    await vi.advanceTimersByTimeAsync(3_000)
    announceZapFailure('No route to the recipient.')
    await vi.advanceTimersByTimeAsync(2_000)
    await pending
    expect(currentOutcome()?.message).toBe('No route to the recipient.')
  })

  it('is still recognisable as the signer it wraps', () => {
    /* `SessionProvider` decides what to sleep, wake and dispose with `instanceof. */
    class Fake {
      kind = 'nip46' as const
      async getPublicKey(): Promise<never> {
        return 'f'.repeat(64) as never
      }
      async signEvent(t: EventTemplate): Promise<NostrEvent> {
        return { ...t, id: 'x', pubkey: 'f', sig: 's' } as NostrEvent
      }
    }
    const wrapped = patientSigner(new Fake() as unknown as Signer)
    expect(wrapped instanceof Fake).toBe(true)
    expect(wrapped.kind).toBe('nip46')
  })
})
