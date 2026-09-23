'use client'

import { announceWarning, dismissOutcome } from './outcome'

/** The signer asking for the reader, mid-session. */
const ASKING = 'Your signer needs you to approve this.'

let showing: number | undefined

export function askToApprove(url: string): void {
  /* Sanity-check what the signer sent before making it an href. */
  let href: URL
  try {
    href = new URL(url)
  } catch {
    return
  }
  if (href.protocol !== 'https:' && href.protocol !== 'http:') return

  showing = announceWarning(ASKING, { label: 'Approve', href: href.toString() })
}

/** Called when the request that was waiting finally settles. */
export function approvalSettled(): void {
  if (showing === undefined) return
  dismissOutcome(showing)
  showing = undefined
}
