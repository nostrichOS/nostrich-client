import { storedAccountsSchema, storedSessionSchema } from '@nostrich/types'
import type { StoredAccounts, StoredSession } from '@nostrich/types'

/** Pre-multi-account key: a single session. */
const LEGACY_KEY = 'nostrich.session'
const STORAGE_KEY = 'nostrich.accounts'

export type { StoredAccounts, StoredSession }

const EMPTY: StoredAccounts = { accounts: [] }

/** Which accounts to offer on the next load, and which was in front. */
export function readStoredAccounts(): StoredAccounts {
  if (typeof window === 'undefined') return EMPTY
  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return EMPTY
  }

  if (raw === null) return migrateLegacy()

  try {
    // Untrusted input: another tab, an older build, or a user poking at devtools.
    const parsed = storedAccountsSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
  } catch {
    // Malformed JSON.
  }
  /** Only genuine corruption gets here now, and only genuine corruption should. */
  clearStoredAccounts()
  return EMPTY
}

function migrateLegacy(): StoredAccounts {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(LEGACY_KEY)
  } catch {
    return EMPTY
  }
  if (raw === null) return EMPTY
  try {
    window.localStorage.removeItem(LEGACY_KEY)
    const parsed = storedSessionSchema.safeParse(JSON.parse(raw))
    if (parsed.success) {
      const migrated: StoredAccounts = { accounts: [parsed.data], active: parsed.data.pubkey }
      writeStoredAccounts(migrated)
      return migrated
    }
  } catch {
    // Malformed JSON.
  }
  return EMPTY
}

/** Written only after the schema agrees it may. */
export function writeStoredAccounts(value: StoredAccounts): void {
  if (typeof window === 'undefined') return
  const checked = storedAccountsSchema.safeParse(value)
  const safe = checked.success ? checked.data : EMPTY
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
  } catch {
    // Storage denied.
  }
}

export function clearStoredAccounts(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(LEGACY_KEY)
  } catch {
    // Nothing to do.
  }
}

/** Whether a session is on disk, answered synchronously. */
export function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_KEY)
    if (raw === null || raw === '') return false
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.length > 0
    /** An ACCOUNT, not merely an object. */
    if (typeof parsed !== 'object' || parsed === null) return false
    const accounts = (parsed as { accounts?: unknown }).accounts
    if (!Array.isArray(accounts)) return false
    return accounts.some(
      entry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { kind?: unknown }).kind === 'string' &&
        /^[0-9a-f]{64}$/.test(String((entry as { pubkey?: unknown }).pubkey)),
    )
  } catch {
    return false
  }
}
