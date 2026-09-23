import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Hex, Profile } from '@nostrich/nostr'

/** What has to survive a reload. */

const KEY = 'nostrich:profiles:v1'
const NIP05_KEY = 'nostrich:nip05:v1'
const MAX_ENTRIES = 2_000

const NOW = Date.UTC(2026, 7, 15)
const DAY = 24 * 60 * 60 * 1_000

type Cache = typeof import('./profile-cache')

const hex = (seed: string): Hex => seed.repeat(64).slice(0, 64) as Hex
/** Distinct pubkeys for the bulk cases, ordered so `nth(0)` is the one written first. */
const nth = (index: number): Hex => index.toString(16).padStart(64, '0') as Hex

const ALICE = hex('aa')
const BOB = hex('bb')

/** The store is read once, at module evaluation, so anything that cares about disk. */
async function loadCache(): Promise<Cache> {
  vi.resetModules()
  return import('./profile-cache')
}

/** What the next page load would find, without going through the module to look. */
function persisted(key: string): Record<string, unknown> {
  const raw = localStorage.getItem(key)
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>)
}

/** A profile with every field a relay can hand us, so nothing is dropped by omission. */
const FULL: Profile = {
  pubkey: ALICE,
  name: 'alice',
  displayName: 'Alice Nakamoto',
  about: 'Long enough to be the reason it is not stored. '.repeat(8),
  picture: 'https://cdn.example/alice.jpg',
  banner: 'https://cdn.example/alice-banner.jpg',
  nip05: 'alice@nostrich.org',
  lud16: 'alice@wallet.example',
  website: 'https://alice.example',
  updatedAt: 1_760_000_000,
}

/** Written one at a time with an ascending clock: index order is recency order. */
function fill(cache: Cache, count: number): void {
  for (let index = 0; index < count; index += 1) {
    vi.setSystemTime(NOW + index)
    cache.writeCachedProfile(nth(index), { pubkey: nth(index), name: `#${index}`, updatedAt: 0 })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the round trip', () => {
  it('carries every stored field across a reload', async () => {
    const cache = await loadCache()
    cache.writeCachedProfile(ALICE, FULL)
    vi.runAllTimers()

    const cached = (await loadCache()).readCachedProfile(ALICE)

    expect(cached?.profile.name).toBe(FULL.name)
    expect(cached?.profile.displayName).toBe(FULL.displayName)
    expect(cached?.profile.picture).toBe(FULL.picture)
    expect(cached?.profile.nip05).toBe(FULL.nip05)
    // The two that actually went missing in production.
    expect(cached?.profile.banner).toBe(FULL.banner)
    expect(cached?.profile.lud16).toBe(FULL.lud16)
  })

  /** `about` is the one omission the rest of the app is built around: profiles.ts hands. */
  it('leaves the bio out', async () => {
    const cache = await loadCache()
    cache.writeCachedProfile(ALICE, FULL)

    expect(cache.readCachedProfile(ALICE)?.profile.about).toBeUndefined()
  })

  /** The kind-0's own timestamp is not stored, and zero is the only honest stand-in. */
  it('dates the profile to the epoch and the entry to when it was written', async () => {
    const cache = await loadCache()
    cache.writeCachedProfile(ALICE, FULL)

    const cached = cache.readCachedProfile(ALICE)
    expect(cached?.profile.updatedAt).toBe(0)
    expect(cached?.at).toBe(NOW)
  })

  /** A screenful of notes resolves dozens of profiles. */
  it('is readable before the debounced write and writes once for the batch', async () => {
    const cache = await loadCache()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    fill(cache, 30)
    expect(cache.readCachedProfile(nth(0))?.profile.name).toBe('#0')
    expect(setItem).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(setItem).toHaveBeenCalledTimes(1)
  })
})

describe('the size cap', () => {
  it('keeps the newest entries and forgets the oldest, on disk and in memory', async () => {
    const cache = await loadCache()
    fill(cache, MAX_ENTRIES + 10)
    vi.runAllTimers()

    expect(Object.keys(persisted(KEY))).toHaveLength(MAX_ENTRIES)

    // Eviction has to reach the in-memory map too, or a long session grows without bound.
    expect(cache.readCachedProfile(nth(0))).toBeUndefined()
    expect(cache.readCachedProfile(nth(9))).toBeUndefined()
    expect(cache.readCachedProfile(nth(10))?.profile.name).toBe('#10')
    expect(cache.readCachedProfile(nth(MAX_ENTRIES + 9))?.profile.name).toBe(`#${MAX_ENTRIES + 9}`)
  })
})

describe('damaged storage', () => {
  /** Whatever is on disk, the app has to start. */
  it('starts empty on unparseable JSON and persists the next write anyway', async () => {
    localStorage.setItem(KEY, '{not json')
    const cache = await loadCache()

    expect(cache.readCachedProfile(ALICE)).toBeUndefined()

    cache.writeCachedProfile(ALICE, FULL)
    vi.runAllTimers()
    expect(Object.keys(persisted(KEY))).toEqual([ALICE])
  })

  /** One damaged row must not cost the other 799. Dropping the whole map on a single bad. */
  it('drops only the entries it cannot trust', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        [ALICE]: { n: 'alice', b: 'https://cdn.example/a.jpg', t: NOW },
        [nth(1)]: null,
        [nth(2)]: 'not an object',
        [nth(3)]: { n: 'no timestamp' },
        [nth(4)]: { n: 'timestamp is a string', t: String(NOW) },
      }),
    )
    const cache = await loadCache()

    expect(cache.readCachedProfile(ALICE)?.profile.banner).toBe('https://cdn.example/a.jpg')
    for (const index of [1, 2, 3, 4]) {
      expect(cache.readCachedProfile(nth(index))).toBeUndefined()
    }
  })

  /** Past thirty days the stored copy is dropped rather than painted: a year-old avatar. */
  it('forgets entries older than the maximum age', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        [ALICE]: { n: 'stale but usable', t: NOW - 29 * DAY },
        [BOB]: { n: 'ancient', t: NOW - 31 * DAY },
      }),
    )
    const cache = await loadCache()

    expect(cache.readCachedProfile(ALICE)?.profile.name).toBe('stale but usable')
    expect(cache.readCachedProfile(BOB)).toBeUndefined()
  })
})

describe('a full disk', () => {
  const quota = (): never => {
    throw new DOMException('quota exceeded', 'QuotaExceededError')
  }

  /** The flush runs on a timer, so an escaping exception is an unhandled error. */
  it('gives up quietly instead of throwing', async () => {
    const cache = await loadCache()
    cache.writeCachedProfile(ALICE, FULL)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(quota)

    expect(() => vi.runAllTimers()).not.toThrow()
    expect(setItem).toHaveBeenCalledTimes(2)
    expect(cache.readCachedProfile(ALICE)?.profile.lud16).toBe(FULL.lud16)
  })

  it('retries with half the cache rather than persisting nothing', async () => {
    const cache = await loadCache()
    // Comfortably over half the cap, so halving genuinely drops something.
    const filled = MAX_ENTRIES / 2 + 200
    fill(cache, filled)

    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(quota)
    vi.runAllTimers()

    // Half of the cap, newest first.
    expect(Object.keys(persisted(KEY))).toHaveLength(MAX_ENTRIES / 2)
    const reloaded = await loadCache()
    expect(reloaded.readCachedProfile(nth(filled - 1))?.profile.name).toBe(`#${filled - 1}`)
    expect(reloaded.readCachedProfile(nth(filled - MAX_ENTRIES / 2 - 1))).toBeUndefined()
  })
})

describe('NIP-05 verdicts', () => {
  /** The verdict belongs to the claim, not to the pubkey. */
  it('does not carry a verdict over to a different claim', async () => {
    const cache = await loadCache()
    cache.writeCachedNip05(ALICE, 'alice@nostrich.org', true)

    expect(cache.readCachedNip05(ALICE, 'alice@nostrich.org')?.ok).toBe(true)
    expect(cache.readCachedNip05(ALICE, 'alice@somewhere.example')).toBeUndefined()
  })

  it('forgets a verdict older than a day but keeps a recent one', async () => {
    localStorage.setItem(
      NIP05_KEY,
      JSON.stringify({
        [`${ALICE}|alice@nostrich.org`]: { ok: true, t: NOW - 60_000 },
        [`${BOB}|bob@nostrich.org`]: { ok: true, t: NOW - 2 * DAY },
      }),
    )
    const cache = await loadCache()

    expect(cache.readCachedNip05(ALICE, 'alice@nostrich.org')?.ok).toBe(true)
    expect(cache.readCachedNip05(BOB, 'bob@nostrich.org')).toBeUndefined()
  })
})

/** Deliberately not asserted here: that a profile arriving with no name, display name. */
