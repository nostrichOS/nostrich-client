import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Limiter, TtlCache, chunk, envInt, parseRelays } from './runtime'

/** The shared worker runtime. */

describe('chunk', () => {
  it('splits exactly at the size, because relays reject an oversized REQ whole', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('never emits a chunk larger than the limit', () => {
    const items = Array.from({ length: 401 }, (_, i) => i)
    const parts = chunk(items, 200)
    expect(parts).toHaveLength(3)
    expect(parts.every(part => part.length <= 200)).toBe(true)
    expect(parts.flat()).toEqual(items)
  })

  it('handles the empty list without producing an empty filter', () => {
    // A REQ with an empty authors list matches nothing on some relays and everything.
    expect(chunk([], 200)).toEqual([])
  })
})

describe('envInt', () => {
  const saved = process.env['TEST_ENV_INT']
  afterEach(() => {
    if (saved === undefined) delete process.env['TEST_ENV_INT']
    else process.env['TEST_ENV_INT'] = saved
  })

  it('takes a sane value', () => {
    process.env['TEST_ENV_INT'] = '42'
    expect(envInt('TEST_ENV_INT', 7)).toBe(42)
  })

  it('falls back rather than letting a typo become a zero or a negative interval', () => {
    // A zero poll interval is a busy loop.
    for (const raw of ['', '   ', 'abc', '0', '-5', 'NaN', '60s', '1.5', '1.5e400', '1_000', ' 12 34']) {
      process.env['TEST_ENV_INT'] = raw
      expect(envInt('TEST_ENV_INT', 7)).toBe(7)
    }
    delete process.env['TEST_ENV_INT']
    expect(envInt('TEST_ENV_INT', 7)).toBe(7)
  })
})

describe('parseRelays', () => {
  it('falls back to the defaults rather than watching nothing', () => {
    // A worker with no relays connects to nothing and reports no error: every user simply.
    for (const raw of [undefined, '', '   ', ',,,', 'not a relay']) {
      expect(parseRelays(raw).length).toBeGreaterThan(0)
    }
  })

  it('normalises and deduplicates, so one relay is not two sockets', () => {
    const relays = parseRelays('wss://relay.example, wss://relay.example/, wss://other.example')
    expect(relays).toHaveLength(2)
  })

  it('drops the unusable entries and keeps the rest', () => {
    const relays = parseRelays('wss://good.example, ftp://x.example, , wss://also-good.example')
    expect(relays).toHaveLength(2)
    expect(relays.every(url => url.startsWith('wss://'))).toBe(true)
  })

  it('upgrades a plain http entry rather than discarding it', () => {
    // A relay written as `https://` in the env is a spelling, not a mistake.
    expect(parseRelays('https://a.example, wss://a.example')).toEqual(['wss://a.example'])
  })
})

describe('Limiter', () => {
  it('never runs more than the limit at once', async () => {
    const limiter = new Limiter(3)
    let active = 0
    let peak = 0
    let started = 0
    const release: Array<() => void> = []

    for (let i = 0; i < 10; i += 1) {
      limiter.run(async () => {
        started += 1
        active += 1
        peak = Math.max(peak, active)
        await new Promise<void>(resolve => release.push(resolve))
        active -= 1
      })
    }

    // Let the first batch reach its await, then check nothing beyond the limit started.
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve()
    expect(started).toBe(3)
    expect(peak).toBe(3)

    const drained = limiter.drain()
    // Free them one at a time.
    for (let i = 0; i < 20 && release.length > 0; i += 1) {
      release.shift()?.()
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve()
    }
    await drained
    expect(started).toBe(10)
    expect(peak).toBe(3)
  })

  it('releases the slot when a task throws', async () => {
    // The one that would be invisible: a task that throws without releasing leaves.
    const limiter = new Limiter(1)
    const ran: string[] = []

    limiter.run(async () => {
      ran.push('boom')
      throw new Error('task failed')
    })
    limiter.run(async () => {
      ran.push('after')
    })

    await limiter.drain()
    expect(ran).toEqual(['boom', 'after'])
  })

  it('drains everything, including work queued behind the limit', async () => {
    const limiter = new Limiter(2)
    let done = 0
    for (let i = 0; i < 12; i += 1) {
      limiter.run(async () => {
        await Promise.resolve()
        done += 1
      })
    }
    await limiter.drain()
    expect(done).toBe(12)
  })

  it('drains immediately when nothing is queued', async () => {
    await expect(new Limiter(4).drain()).resolves.toBeUndefined()
  })
})

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks once and serves the answer from memory', async () => {
    const load = vi.fn(async (key: string) => `value:${key}`)
    const cache = new TtlCache(60_000, 10, load)

    expect(await cache.get('a')).toBe('value:a')
    expect(await cache.get('a')).toBe('value:a')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent lookups of the same key', async () => {
    // A hot pubkey.
    let resolveLoad: (value: string) => void = () => {}
    const load = vi.fn(() => new Promise<string>(resolve => { resolveLoad = resolve }))
    const cache = new TtlCache(60_000, 10, load)

    const all = Promise.all([cache.get('hot'), cache.get('hot'), cache.get('hot')])
    resolveLoad('once')
    expect(await all).toEqual(['once', 'once', 'once'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('asks again once the entry is stale', async () => {
    const load = vi.fn(async () => 'fresh')
    const cache = new TtlCache(60_000, 10, load)

    await cache.get('a')
    vi.advanceTimersByTime(59_000)
    await cache.get('a')
    expect(load).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2_000)
    await cache.get('a')
    expect(load).toHaveBeenCalledTimes(2)
  })

  /** THE ONE THAT MUTES PEOPLE. */
  it('forgets a miss sooner than a hit', async () => {
    const load = vi.fn(async (key: string) => (key === 'missing' ? null : 'found'))
    const cache = new TtlCache<string | null>(
      6 * 60 * 60_000,
      10,
      load,
      value => (value === null ? 10 * 60_000 : 6 * 60 * 60_000),
    )

    expect(await cache.get('missing')).toBeNull()
    expect(await cache.get('present')).toBe('found')
    expect(load).toHaveBeenCalledTimes(2)

    // Eleven minutes on: the miss is retried, the hit.
    vi.advanceTimersByTime(11 * 60_000)
    await cache.get('missing')
    await cache.get('present')
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('evicts the oldest when it is full, and keeps what was just used', async () => {
    const load = vi.fn(async (key: string) => key)
    const cache = new TtlCache(60_000, 2, load)

    await cache.get('a')
    await cache.get('b')
    await cache.get('c')
    expect(load).toHaveBeenCalledTimes(3)

    // 'a' fell out.
    await cache.get('b')
    await cache.get('c')
    expect(load).toHaveBeenCalledTimes(3)
    await cache.get('a')
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('does not cache a rejection, so a thrown lookup is retried', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('relay down'))
      .mockResolvedValue('recovered')
    const cache = new TtlCache<string>(60_000, 10, load as never)

    await expect(cache.get('a')).rejects.toThrow('relay down')
    await expect(cache.get('a')).resolves.toBe('recovered')
  })
})

describe('an unreachable relay cannot kill the process', () => {
  /** Node re-throws an EventEmitter's `'error'` event when nothing is listening. */
  it('attaches a listener at construction and does not swallow the error', async () => {
    const events = await import('node:events')
    const EventEmitter = events.EventEmitter
    type Emitter = InstanceType<typeof EventEmitter>

    class FakeSocket extends EventEmitter {
      constructor(readonly url: string) {
        super()
      }
    }

    // Same shape as the proxy in websocket.ts.
    const Safe = new Proxy(FakeSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget) as Emitter
        socket.on('error', () => {})
        return socket as object
      },
    })

    const bare = new FakeSocket('wss://relay.example')
    expect(() => bare.emit('error', new Error('connect ETIMEDOUT'))).toThrow('connect ETIMEDOUT')

    const guarded = new Safe('wss://relay.example') as Emitter
    expect(() => guarded.emit('error', new Error('connect ETIMEDOUT'))).not.toThrow()

    const seen: string[] = []
    guarded.on('error', (err: Error) => seen.push(err.message))
    guarded.emit('error', new Error('connect ECONNREFUSED'))
    expect(seen).toEqual(['connect ECONNREFUSED'])
  })
})
