import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Every window is one request to our own endpoint, cached, deduped and retried once. */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const { fetchTrending } = await import('./trending')

/** A built snapshot, in the shape our endpoint serves. */
function ok(ids: string[]): Response {
  return {
    ok: true,
    json: async () => ({
      ready: true,
      builtAt: Date.now(),
      notes: ids.map(id => ({
        id,
        pubkey: 'c'.repeat(64),
        createdAt: 1_700_000_000,
        content: 'hello',
        tags: [],
        counts: { replies: 1, reposts: 0, reactions: 1, zapSats: 0, zapCount: 0 },
      })),
      profiles: [],
    }),
  } as unknown as Response
}

/** Answer our endpoint with `impl`, counting the calls. */
function serve(impl: (n: number) => Response | Promise<Response>): void {
  let calls = 0
  fetchMock.mockImplementation(async () => {
    calls += 1
    return impl(calls)
  })
}

const callCount = (): number => fetchMock.mock.calls.length

const ID_A = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)

/* A DIFFERENT WINDOW PER TEST, because the cache these defend is module state. */
/* And a fresh clock per test, well ahead of the last one. */
let clock = Date.now()

beforeEach(() => {
  vi.useFakeTimers()
  clock += 24 * 60 * 60_000
  vi.setSystemTime(clock)
  fetchMock.mockReset()
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('fetchTrending', () => {
  it('asks once when two callers want the same window at the same moment', async () => {
    serve(() => ok([ID_A]))
    const both = Promise.all([fetchTrending(2), fetchTrending(2)])
    await vi.advanceTimersByTimeAsync(50)
    const [first, second] = await both

    expect(callCount()).toBe(1)
    expect(first).toEqual(second)
    expect(first[0]?.id).toBe(ID_A)
  })

  it('spaces requests for different windows more than a second apart', async () => {
    const at: number[] = []
    serve(() => {
      at.push(Date.now())
      return ok([ID_A])
    })

    const all = Promise.all([fetchTrending(3), fetchTrending(5), fetchTrending(6)])
    await vi.advanceTimersByTimeAsync(10_000)
    await all

    expect(at).toHaveLength(3)
    // Three windows opening at once must not arrive as one burst.
    expect(at[1]! - at[0]!).toBeGreaterThan(1_000)
    expect(at[2]! - at[1]!).toBeGreaterThan(1_000)
  })

  it('retries once, because a dropped request usually succeeds on the second try', async () => {
    serve(n => {
      if (n === 1) throw new TypeError('Failed to fetch')
      return ok([ID_B])
    })
    const result = fetchTrending(7)
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(result).resolves.toMatchObject([{ id: ID_B }])
    expect(callCount()).toBe(2)
  })

  it('serves the last good list rather than an empty tab when the endpoint is unreachable', async () => {
    serve(() => ok([ID_A]))
    const primed = fetchTrending(8)
    await vi.advanceTimersByTimeAsync(10_000)
    await primed

    // Past the two-minute freshness window, so this is a real request, and it fails twice.
    await vi.advanceTimersByTimeAsync(200_000)
    serve(() => {
      throw new TypeError('Failed to fetch')
    })
    const again = fetchTrending(8)
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(again).resolves.toMatchObject([{ id: ID_A }])
  })

  it('gives up rather than showing an hours-old ranking', async () => {
    serve(() => ok([ID_A]))
    const primed = fetchTrending(9)
    await vi.advanceTimersByTimeAsync(10_000)
    await primed

    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    serve(() => {
      throw new TypeError('Failed to fetch')
    })
    // The assertion is attached BEFORE the clock moves: the rejection happens.
    const settled = expect(fetchTrending(9)).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10_000)
    await settled
  })

  it('answers a fresh window from cache without touching the network', async () => {
    serve(() => ok([ID_A]))
    const primed = fetchTrending(12)
    await vi.advanceTimersByTimeAsync(10_000)
    await primed
    fetchMock.mockClear()

    await expect(fetchTrending(12)).resolves.toMatchObject([{ id: ID_A }])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the counts and profiles the snapshot already carries', async () => {
    // The whole point of building trending on our own box: one request, already filtered.
    fetchMock.mockImplementation(async (url: string) => {
      if (!String(url).startsWith('/api/trending')) throw new Error('nothing else may be asked')
      return {
        ok: true,
        json: async () => ({
          ready: true,
          hours: 11,
          notes: [
            {
              id: ID_A,
              pubkey: 'c'.repeat(64),
              createdAt: 1_700_000_000,
              content: 'hello',
              tags: [],
              counts: { replies: 4, reposts: 2, reactions: 30, zapSats: 1000, zapCount: 3 },
            },
          ],
          profiles: [{ pubkey: 'c'.repeat(64), profile: { name: 'Alice', nip05: 'a@b.com' } }],
        }),
      } as unknown as Response
    })

    const entries = await fetchTrending(11)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe(ID_A)
    expect(entries[0]?.replies).toBe(4)
  })
})
