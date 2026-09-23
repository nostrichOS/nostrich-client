'use client'

import type { EventTemplate, NostrEvent, Signer } from '@nostrich/nostr'

import { announceWarning, dismissOutcome } from './outcome'
import { approvalSettled } from './signer-approval'

/** Say "waiting" when a signature is slow, and only when it actually. */
const SLOW_MS = 2_500

const WAITING = 'Waiting for your signer…'

export function patientSigner<T extends Signer>(signer: T): T {
  /* `Object.create`, not a fresh object literal. */
  const patient = Object.create(signer) as T & {
    signEvent: (template: EventTemplate) => Promise<NostrEvent>
  }

  patient.signEvent = (template: EventTemplate): Promise<NostrEvent> => {
    let announced: number | undefined
    const slow = setTimeout(() => {
      announced = announceWarning(WAITING)
    }, SLOW_MS)
    return signer.signEvent(template).finally(() => {
      clearTimeout(slow)
      // Guarded: `dismissOutcome()` with nothing to match clears whatever IS showing.
      if (announced !== undefined) dismissOutcome(announced)
      approvalSettled()
    })
  }

  return patient
}
