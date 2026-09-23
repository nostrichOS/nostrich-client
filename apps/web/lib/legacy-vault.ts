'use client'

/** Destroys the abandoned key vault. */

const DEAD_DB = 'nostrich-vault'

export function deleteLegacyVault(): void {
  if (typeof indexedDB === 'undefined') return
  try {
    // Fire-and-forget by design.
    indexedDB.deleteDatabase(DEAD_DB)
  } catch {
    // A browser that refuses the call has no vault to worry about either.
  }
}
