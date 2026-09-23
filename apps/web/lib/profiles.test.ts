import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INDEXER_RELAYS, DEFAULT_RELAYS, type NostrEvent, type QueryOutcome } from '@nostrich/nostr'

const queryWithStatus = vi.fn<(...args: unknown[]) => Promise<QueryOutcome>>()

vi.mock('./pool', () => ({ getPool: () => ({ queryWithStatus }) }))

const { loadProfile, profileQuery } = await import('./profiles')
const { writeCachedProfile } = await import('./profile-cache')

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

/** The relays kind-0 lookups are pinned to: the indexers plus the defaults. */
const RELAY_COUNT = DEFAULT_RELAYS.length + DEFAULT_INDEXER_RELAYS.length
const QUORUM = Math.ceil(RELAY_COUNT / 2)

function metadata(pubkey: string, name: string, createdAt = 1_700_000_000): NostrEvent {
  return {
    id: pubkey.slice(0, 64),
    pubkey,
    created_at: createdAt,
    kind: 0,
    tags: [],
    content: JSON.stringify({ name, display_name: name }),
    sig: '0'.repeat(128),
  }
}

function outcome(events: NostrEvent[], answered: number): QueryOutcome {
  return { events, answered, attempted: RELAY_COUNT }
}

beforeEach(() => {
  queryWithStatus.mockReset()
})

/** The rule this file exists. */
describe('loadProfile', () => {
  it('rejects rather than reporting an absence when no relay answered', async () => {
    queryWithStatus.mockResolvedValue(outcome([], 0))
    await expect(loadProfile(ALICE)).rejects.toThrow(new RegExp(`0/${RELAY_COUNT} relays answered`))
  })

  it('rejects when a minority answered and the author was not among them', async () => {
    // The exact shape of the reported bug: one relay replied, and it was the wrong one.
    queryWithStatus.mockResolvedValue(outcome([], 1))
    await expect(loadProfile(ALICE)).rejects.toThrow(new RegExp(`1/${RELAY_COUNT} relays answered`))
  })

  it('resolves null once a majority answered and none of them had it', async () => {
    queryWithStatus.mockResolvedValue(outcome([], QUORUM))
    await expect(loadProfile(ALICE)).resolves.toBeNull()
  })

  it('resolves the profile when it is found, however few relays answered', async () => {
    queryWithStatus.mockResolvedValue(outcome([metadata(ALICE, 'Alice')], 1))
    await expect(loadProfile(ALICE)).resolves.toMatchObject({ name: 'Alice' })
  })

  it('rejects only the authors that were missing, in a batch where others were found', async () => {
    queryWithStatus.mockResolvedValue(outcome([metadata(ALICE, 'Alice')], 1))
    const [alice, bob] = await Promise.allSettled([loadProfile(ALICE), loadProfile(BOB)])
    expect(alice.status).toBe('fulfilled')
    expect(bob.status).toBe('rejected')
  })

  it('asks once for two callers wanting the same person', async () => {
    queryWithStatus.mockResolvedValue(outcome([metadata(ALICE, 'Alice')], RELAY_COUNT))
    const both = await Promise.all([loadProfile(ALICE), loadProfile(ALICE)])
    expect(queryWithStatus).toHaveBeenCalledTimes(1)
    expect(both[0]).toEqual(both[1])
  })

  it('folds callers arriving mid-flight into the request already on the wire', async () => {
    let release: (value: QueryOutcome) => void = () => {}
    queryWithStatus.mockReturnValueOnce(new Promise<QueryOutcome>(r => (release = r)))

    const first = loadProfile(ALICE)
    // Past the 90ms coalescing window: the batch is out, so the old code opened a second.
    await vi.waitFor(() => expect(queryWithStatus).toHaveBeenCalledTimes(1), { timeout: 1_000 })
    const second = loadProfile(ALICE)

    release(outcome([metadata(ALICE, 'Alice')], RELAY_COUNT))
    await expect(second).resolves.toMatchObject({ name: 'Alice' })
    await expect(first).resolves.toMatchObject({ name: 'Alice' })
    expect(queryWithStatus).toHaveBeenCalledTimes(1)
  })

  it('holds a third batch back while two are in the air, and sends it as one', async () => {
    const releases: Array<(value: QueryOutcome) => void> = []
    queryWithStatus.mockImplementation(
      () => new Promise<QueryOutcome>(r => releases.push(r)),
    )

    const a = loadProfile('1'.repeat(64))
    await vi.waitFor(() => expect(releases).toHaveLength(1), { timeout: 1_000 })
    const b = loadProfile('2'.repeat(64))
    await vi.waitFor(() => expect(releases).toHaveLength(2), { timeout: 1_000 })

    // Two batches are running.
    const c = loadProfile('3'.repeat(64))
    const d = loadProfile('4'.repeat(64))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(queryWithStatus).toHaveBeenCalledTimes(2)

    releases[0]?.(outcome([], RELAY_COUNT))
    await a
    await vi.waitFor(() => expect(releases).toHaveLength(3), { timeout: 1_000 })
    const third = queryWithStatus.mock.calls[2]?.[0] as Array<{ authors: string[] }>
    expect(third[0]?.authors).toHaveLength(2)

    releases[1]?.(outcome([], RELAY_COUNT))
    releases[2]?.(outcome([], RELAY_COUNT))
    await Promise.all([b, c, d])
  })
})

describe('a profile is never replaced by nothing', () => {
  /** `loadProfile` resolves `null` when the relays answered and none held a kind-0. */
  const PERSON = 'f'.repeat(64) as never

  it('keeps the stored profile when the relays answer empty', async () => {
    writeCachedProfile(PERSON, { pubkey: PERSON, name: 'Nostrich', picture: 'https://x/y.png' } as never)
    queryWithStatus.mockResolvedValue({ events: [], answered: 5 } as never)
    const result = await profileQuery(PERSON).queryFn()
    expect(result?.name).toBe('Nostrich')
    expect(result?.picture).toBe('https://x/y.png')
  })

  it('still reports nothing for somebody we have never seen', async () => {
    // The rule protects a picture already in hand.
    queryWithStatus.mockResolvedValue({ events: [], answered: 5 } as never)
    const result = await profileQuery(('a'.repeat(64)) as never).queryFn()
    expect(result).toBeNull()
  })
})

/** A PROFILE IS HANDED OVER WHEN IT ARRIVES, not when its batch finishes. */
describe('delivery on arrival', () => {
  /** A query that streams one event and then never finishes until the test says. */
  function streaming(event: NostrEvent): () => void {
    let release = (): void => {}
    queryWithStatus.mockImplementation((...args: unknown[]) => {
      const options = args[3] as { onEvent?: (event: NostrEvent) => void } | undefined
      options?.onEvent?.(event)
      return new Promise<QueryOutcome>(resolve => {
        release = () => resolve(outcome([event], QUORUM))
      })
    })
    return () => release()
  }

  it('resolves from the arriving event, before the query has settled', async () => {
    const release = streaming(metadata(ALICE, 'Alice'))
    await expect(loadProfile(ALICE)).resolves.toMatchObject({ name: 'Alice' })
    release()
    await new Promise(resolve => setTimeout(resolve, 20))
  })

  it('gives a caller who arrives mid-flight the profile that already came in', async () => {
    /* The race this exists. */
    const release = streaming(metadata(BOB, 'Bob'))
    await expect(loadProfile(BOB)).resolves.toMatchObject({ name: 'Bob' })
    await expect(loadProfile(BOB)).resolves.toMatchObject({ name: 'Bob' })
    release()
    await new Promise(resolve => setTimeout(resolve, 20))
  })

  it('still decides absence from the settled query, which is the only thing that can', async () => {
    // Nothing streamed: whether this is "no profile" or "nobody answered" is a fact.
    queryWithStatus.mockResolvedValue(outcome([], 1))
    await expect(loadProfile(ALICE)).rejects.toThrow(new RegExp(`1/${RELAY_COUNT} relays answered`))
  })
})
