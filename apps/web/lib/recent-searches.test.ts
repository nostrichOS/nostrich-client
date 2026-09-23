import { beforeEach, describe, expect, it } from 'vitest'
import type { Hex } from '@nostrich/nostr'

import {
  clearSearches,
  forgetRecent,
  forgetRecentCache,
  recentKey,
  rememberProfileVisit,
  rememberSearch,
} from './recent-searches'

/** The Recent list under the search field, which now holds searches AND profiles. */

const KEY = 'nostrich:recent-searches:v2'
const LEGACY = 'nostrich:recent-searches'
const ALICE = 'a'.repeat(64) as Hex
const BOB = 'b'.repeat(64) as Hex
const stored = (): unknown[] => JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[]

beforeEach(() => {
  localStorage.clear()
  forgetRecentCache()
})

describe('recent entries', () => {
  it('keeps searches and profiles in one list, newest first', () => {
    rememberSearch('bitcoin')
    rememberProfileVisit(ALICE)
    rememberSearch('nostr')
    expect(stored()).toEqual([
      { kind: 'query', term: 'nostr' },
      { kind: 'profile', pubkey: ALICE },
      { kind: 'query', term: 'bitcoin' },
    ])
  })

  it('moves a profile to the top instead of listing it twice', () => {
    rememberProfileVisit(ALICE)
    rememberSearch('bitcoin')
    rememberProfileVisit(ALICE)
    expect(stored()).toHaveLength(2)
    expect(stored()[0]).toEqual({ kind: 'profile', pubkey: ALICE })
  })

  it('still de-duplicates searches case-insensitively, keeping the newest casing', () => {
    rememberSearch('btc')
    rememberSearch('BTC')
    expect(stored()).toEqual([{ kind: 'query', term: 'BTC' }])
  })

  it('refuses anything that is not a pubkey', () => {
    rememberProfileVisit(undefined)
    rememberProfileVisit('npub1whatever' as Hex)
    rememberProfileVisit('' as Hex)
    expect(stored()).toEqual([])
  })

  it('removes one entry without touching the other kind', () => {
    rememberSearch('bitcoin')
    rememberProfileVisit(ALICE)
    forgetRecent({ kind: 'profile', pubkey: ALICE })
    expect(stored()).toEqual([{ kind: 'query', term: 'bitcoin' }])
  })

  it('caps the list at ten across both kinds', () => {
    for (let at = 0; at < 8; at += 1) rememberSearch(`q${at}`)
    rememberProfileVisit(ALICE)
    rememberProfileVisit(BOB)
    rememberSearch('newest')
    expect(stored()).toHaveLength(10)
    expect(stored()[0]).toEqual({ kind: 'query', term: 'newest' })
  })

  it('clears everything, which is what "Clear all" promises', () => {
    rememberSearch('bitcoin')
    rememberProfileVisit(ALICE)
    clearSearches()
    expect(stored()).toEqual([])
  })

  it('migrates a v1 list of plain strings rather than discarding it', () => {
    localStorage.setItem(LEGACY, JSON.stringify(['bitcoin', 'nostr']))
    forgetRecentCache()
    rememberProfileVisit(ALICE)
    expect(stored()).toEqual([
      { kind: 'profile', pubkey: ALICE },
      { kind: 'query', term: 'bitcoin' },
      { kind: 'query', term: 'nostr' },
    ])
  })

  it('gives the two kinds distinct identities', () => {
    expect(recentKey({ kind: 'query', term: ALICE })).not.toBe(
      recentKey({ kind: 'profile', pubkey: ALICE }),
    )
  })
})
