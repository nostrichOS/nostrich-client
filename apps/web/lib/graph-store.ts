'use client'

/** The social graph, on disk. */

const DB_NAME = 'nostrich-graph'
const STORE = 'graphs'
/** Bump to invalidate every stored graph. */
const VERSION = 1

/** How long a stored graph stands before it is rebuilt. */
export const GRAPH_MAX_AGE_MS = 24 * 60 * 60_000

interface StoredGraph {
  root: string
  version: number
  at: number
  bytes: Uint8Array
  /** Whether the crawl that produced this graph covered the reader's ENTIRE follow list. */
  complete: boolean
}

function open(): Promise<IDBDatabase | undefined> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(undefined)
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, VERSION)
    } catch {
      return resolve(undefined)
    }
    request.onupgradeneeded = () => {
      const db = request.result
      // Dropped rather than migrated: the payload is an opaque blob in the library's.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE)
      db.createObjectStore(STORE, { keyPath: 'root' })
    }
    request.onsuccess = () => resolve(request.result)
    // Private browsing, a denied quota, or a blocked upgrade.
    request.onerror = () => resolve(undefined)
    request.onblocked = () => resolve(undefined)
  })
}

export async function readStoredGraph(
  root: string,
): Promise<{ bytes: Uint8Array; complete: boolean } | undefined> {
  const db = await open()
  if (db === undefined) return undefined
  try {
    const record = await new Promise<StoredGraph | undefined>(resolve => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(root)
      request.onsuccess = () => resolve(request.result as StoredGraph | undefined)
      request.onerror = () => resolve(undefined)
    })
    if (record === undefined || record.version !== VERSION) return undefined
    if (Date.now() - record.at > GRAPH_MAX_AGE_MS) return undefined
    return { bytes: record.bytes, complete: record.complete === true }
  } catch {
    return undefined
  } finally {
    db.close()
  }
}

export async function writeStoredGraph(
  root: string,
  bytes: Uint8Array,
  complete: boolean,
): Promise<void> {
  const db = await open()
  if (db === undefined) return
  try {
    await new Promise<void>(resolve => {
      const transaction = db.transaction(STORE, 'readwrite')
      // One graph per root, and only the roots that have been used recently: a keyPath.
      transaction.objectStore(STORE).put({ root, version: VERSION, at: Date.now(), bytes, complete })
      transaction.oncomplete = () => resolve()
      // A failed write is a cache miss next time, which is the status quo.
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    })
  } catch {
    // Quota or a closed connection.
  } finally {
    db.close()
  }
}
