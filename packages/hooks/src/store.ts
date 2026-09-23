/** The synchronous key-value store the data layer reads during render. */

export interface SyncStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

/** The store the hooks read. */
let store: SyncStore = memoryStore()

export function installStore(next: SyncStore): void {
  store = next
}

export function getStore(): SyncStore {
  return store
}

export function memoryStore(seed: Record<string, string> = {}): SyncStore {
  const map = new Map(Object.entries(seed))
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  }
}

/** `localStorage`, wrapped so a failure is a miss rather than a crash. */
export function browserStore(): SyncStore {
  return {
    get(key) {
      try {
        return typeof window === 'undefined' ? null : localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
      } catch {
        // Quota, or a private window.
      }
    },
    remove(key) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
      } catch {
        // See above.
      }
    },
  }
}
