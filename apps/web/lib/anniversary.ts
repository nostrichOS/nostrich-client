'use client'

import type { Hex } from '@nostrich/nostr'

/** The day an account first appeared on Nostr, come round again. */

/** Once every four hours, per profile. */
export const CELEBRATION_WINDOW_MS = 4 * 60 * 60 * 1_000

const KEY = 'nostrich:celebrated:'

/** Is `now` the anniversary of `joinedAt`. */
export function isJoinAnniversary(joinedAt: number | undefined, now: Date): boolean {
  if (joinedAt === undefined || !Number.isFinite(joinedAt) || joinedAt <= 0) return false
  const joined = new Date(joinedAt * 1_000)
  if (now.getFullYear() <= joined.getFullYear()) return false

  const month = joined.getMonth()
  const day = joined.getDate()
  if (now.getMonth() === month && now.getDate() === day) return true

  /* February 29th, in a year that has no February 29th. */
  if (month === 1 && day === 29 && now.getMonth() === 1 && now.getDate() === 28) {
    return !isLeapYear(now.getFullYear())
  }
  return false
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Whether to celebrate now. */
export function claimCelebration(pubkey: Hex, now = Date.now()): boolean {
  if (typeof window === 'undefined') return false
  try {
    const last = Number(localStorage.getItem(KEY + pubkey))
    if (Number.isFinite(last) && last > 0 && now - last < CELEBRATION_WINDOW_MS) return false
    localStorage.setItem(KEY + pubkey, String(now))
    return true
  } catch {
    // Private mode: no memory of the last one, so it plays.
    return true
  }
}

/** Forget every record. For the demo trigger and for tests. */
export function forgetCelebrations(): void {
  if (typeof window === 'undefined') return
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(KEY)) localStorage.removeItem(key)
    }
  } catch {
    // Nothing to do.
  }
}
