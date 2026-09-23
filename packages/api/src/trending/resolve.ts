/** Turn the ids one index gives us into the notes the other index already ships. */

import { createPool, type Filter, type Hex, type NostrEvent, type Pool, type RelayUrl } from '@nostrich/nostr'

/** Ids per filter. */
const BATCH = 100

/** A query the build is never allowed to hang behind. */
const QUERY_TIMEOUT_MS = 8_000

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** One filter, asked of the shared pool, never throwing. */
export async function queryRelays(
  filters: Filter[],
  relays: readonly RelayUrl[],
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<NostrEvent[]> {
  if (relays.length === 0) return []
  try {
    return await sharedPool().query(filters, [...relays], timeoutMs)
  } catch {
    return []
  }
}

export interface Resolved {
  events: NostrEvent[]
  profiles: NostrEvent[]
}

/** Fetch these notes and their authors' profiles. */
export async function resolveNotes(
  ids: readonly Hex[],
  relays: readonly RelayUrl[],
  pool: Pool = sharedPool(),
): Promise<Resolved> {
  if (ids.length === 0 || relays.length === 0) return { events: [], profiles: [] }
  try {
    const batches = chunk([...ids], BATCH)
    const results = await Promise.allSettled(
      batches.map(batch => pool.query([{ ids: batch }], [...relays], QUERY_TIMEOUT_MS)),
    )
    const events = new Map<string, NostrEvent>()
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      for (const event of result.value) events.set(event.id, event)
    }

    const authors = [...new Set([...events.values()].map(event => event.pubkey))] as Hex[]
    const profileResults = await Promise.allSettled(
      chunk(authors, BATCH).map(batch =>
        pool.query([{ kinds: [0], authors: batch }], [...relays], QUERY_TIMEOUT_MS),
      ),
    )
    // Newest kind-0 per author.
    const profiles = new Map<string, NostrEvent>()
    for (const result of profileResults) {
      if (result.status !== 'fulfilled') continue
      for (const event of result.value) {
        const held = profiles.get(event.pubkey)
        if (held === undefined || event.created_at > held.created_at) profiles.set(event.pubkey, event)
      }
    }

    return { events: [...events.values()], profiles: [...profiles.values()] }
  } catch {
    return { events: [], profiles: [] }
  }
}

/** ONE POOL, HELD OPEN. */
let pool: Pool | undefined

function sharedPool(): Pool {
  pool ??= createPool()
  return pool
}
