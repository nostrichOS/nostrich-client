import { beforeEach, describe, expect, it } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import {
  editContacts,
  followsFrom,
  forgetContacts,
  latestContacts,
  losesFollows,
  rememberContacts,
} from './contacts'

/** The rules that stop a follow from deleting a follow list. */

const ME = 'a'.repeat(64)
const TARGET = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)

function list(at: number, pubkeys: string[], content = ''): NostrEvent {
  return {
    id: `${at}`.padStart(64, '0'),
    pubkey: ME,
    kind: 3,
    created_at: at,
    content,
    tags: pubkeys.map(pubkey => ['p', pubkey]),
    sig: 'f'.repeat(128),
  } as NostrEvent
}

beforeEach(forgetContacts)

describe('the high-water mark', () => {
  it('keeps the newest list it has been shown', () => {
    rememberContacts(list(2_000, [OTHER, TARGET]))
    rememberContacts(list(1_000, [OTHER]))
    expect(latestContacts(ME)?.created_at).toBe(2_000)
  })

  it('is what a stale relay answer is measured against', () => {
    // February's copy arriving after August's must not become the basis for a write.
    const august = list(2_000, [OTHER, TARGET])
    rememberContacts(august)
    expect(rememberContacts(list(1_700, [OTHER])).created_at).toBe(2_000)
  })

  it('has nothing to say about an account it has not seen', () => {
    expect(latestContacts(ME)).toBeUndefined()
  })
})

describe('editing rather than rebuilding', () => {
  it('adds one tag and leaves the rest of the event alone', () => {
    const previous = list(1_000, [OTHER], '{"wss://relay.example":{"read":true,"write":true}}')
    previous.tags.push(['t', 'bitcoin'])
    const next = editContacts(previous, TARGET, true)
    expect(next.tags.filter(tag => tag[0] === 'p').map(tag => tag[1])).toEqual([OTHER, TARGET])
    // The relay configuration another client stored here is not ours to delete.
    expect(next.content).toBe(previous.content)
    // Nor is a tag we do not understand.
    expect(next.tags).toContainEqual(['t', 'bitcoin'])
  })

  it('removes exactly the one person named', () => {
    const next = editContacts(list(1_000, [OTHER, TARGET]), TARGET, false)
    expect(next.tags.filter(tag => tag[0] === 'p').map(tag => tag[1])).toEqual([OTHER])
  })

  it('keeps a petname and relay hint that belong to somebody else', () => {
    const previous = list(1_000, [])
    previous.tags.push(['p', OTHER, 'wss://relay.example', 'alice'])
    const next = editContacts(previous, TARGET, true)
    expect(next.tags).toContainEqual(['p', OTHER, 'wss://relay.example', 'alice'])
  })

  it('is never older than what it replaces, whatever the clock says', () => {
    // Relays keep the newer of two kind-3s.
    const future = list(Math.floor(Date.now() / 1000) + 600, [OTHER])
    expect(editContacts(future, TARGET, true).created_at).toBeGreaterThan(future.created_at)
  })

  it('works from nothing, for an account with no list yet', () => {
    const next = editContacts(undefined, TARGET, true)
    expect(next.tags).toEqual([['p', TARGET]])
    expect(next.content).toBe('')
  })
})

describe('the last line of defence', () => {
  it('counts nothing lost when a follow is added', () => {
    const previous = list(1_000, [OTHER])
    expect(losesFollows(previous, editContacts(previous, TARGET, true))).toBe(0)
  })

  it('counts exactly one when a follow is removed', () => {
    const previous = list(1_000, [OTHER, TARGET])
    expect(losesFollows(previous, editContacts(previous, TARGET, false))).toBe(1)
  })

  it('counts the whole difference when the base was the wrong list', () => {
    // The bug in one line: a 2,242-follow list, a write built on a 893-follow snapshot.
    const newest = list(2_000, Array.from({ length: 2_242 }, (_, i) => `${i}`.padStart(64, 'd')))
    const stale = list(1_000, Array.from({ length: 893 }, (_, i) => `${i}`.padStart(64, 'd')))
    const fromStale = editContacts(stale, TARGET, true)
    expect(losesFollows(newest, fromStale)).toBe(2_242 - 893)
  })
})

describe('surviving a reload', () => {
  it('remembers the newest list for the account in front', async () => {
    const { setActiveScope } = await import('./scope')
    localStorage.clear()
    forgetContacts()
    setActiveScope(ME)
    rememberContacts(list(2_000, [OTHER, TARGET]))
    // A fresh session: nothing in memory, everything still on disk.
    forgetContacts()
    expect(latestContacts(ME)?.created_at).toBe(2_000)
  })

  it('refuses a stored list belonging to somebody else', async () => {
    const { setActiveScope, writeScoped } = await import('./scope')
    localStorage.clear()
    forgetContacts()
    setActiveScope(ME)
    const theirs = { ...list(2_000, [OTHER]), pubkey: 'e'.repeat(64) }
    writeScoped('nostrich:contacts:v1', JSON.stringify(theirs))
    // Published under this account's key on the next follow, it would replace their list.
    expect(latestContacts(ME)).toBeUndefined()
  })
})

/** The head start that stops a bare `/` waiting five seconds on the network. */
describe('seeding follows from what is already held', () => {
  // `forgetContacts` clears the in-memory high-water map but not what was persisted.
  beforeEach(() => {
    localStorage.clear()
    forgetContacts()
  })

  it('has no answer for an account it has never seen', () => {
    expect(followsFrom(ME)).toBeUndefined()
  })

  it('answers from the cache with no network at all', () => {
    rememberContacts(list(1_000, [OTHER, TARGET]))
    expect(followsFrom(ME)).toEqual({ authors: [OTHER, TARGET], all: [OTHER, TARGET], total: 2 })
  })

  it('counts one follow once, however many times the list names them', () => {
    // A kind-3 may tag the same pubkey twice.
    rememberContacts(list(1_000, [OTHER, OTHER, TARGET]))
    expect(followsFrom(ME)?.total).toBe(2)
  })

  it('reflects the high-water mark, so the seed can never be the older list', () => {
    rememberContacts(list(2_000, [OTHER, TARGET]))
    rememberContacts(list(1_000, [OTHER]))
    expect(followsFrom(ME)?.total).toBe(2)
  })

  it('gives an empty answer rather than none for a list that follows nobody', () => {
    // Distinct from "never seen": we KNOW this account follows nobody, and the feed can.
    rememberContacts(list(1_000, []))
    expect(followsFrom(ME)).toEqual({ authors: [], all: [], total: 0 })
  })

  it('has no answer without a pubkey', () => {
    expect(followsFrom('')).toBeUndefined()
  })
})
