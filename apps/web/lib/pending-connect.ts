'use client'

/** THE HALF-FINISHED PAIRING, WRITTEN DOWN. */

const KEY = 'nostrich:pending-connect'

/** How long a written-down invite may still be resumed. */
export const PENDING_TTL_MS = 5 * 60_000

export interface PendingConnect {
  /** Hex, matching `Nip46Credential`. */
  clientSecretKey: string
  secret: string
  relays: string[]
  /** Unix SECONDS, because it goes straight back into a relay filter's `since`. */
  createdAt: number
}

function isPending(value: unknown): value is PendingConnect {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['clientSecretKey'] === 'string' &&
    typeof v['secret'] === 'string' &&
    typeof v['createdAt'] === 'number' &&
    Array.isArray(v['relays']) &&
    v['relays'].every(relay => typeof relay === 'string')
  )
}

export function readPendingConnect(now = Date.now()): PendingConnect | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!isPending(parsed)) return undefined
    // Expired is the same as absent to every caller, and clearing it here keeps a dead.
    if (now - parsed.createdAt * 1000 > PENDING_TTL_MS) {
      clearPendingConnect()
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

export function writePendingConnect(pending: PendingConnect): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(pending))
  } catch {
    // A denied or full quota costs the resume, not the sign-in: the in-memory invite.
  }
}

export function clearPendingConnect(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to do, and nothing that depends.
  }
}
