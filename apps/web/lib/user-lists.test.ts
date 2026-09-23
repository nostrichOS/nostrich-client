import { beforeEach, describe, expect, it } from 'vitest'
import type { Hex } from '@nostrich/nostr'

import { addToList, inList, isMuted, isRepostMuted, listMembers, toggleList } from './user-lists'
import { scopedRecord, setActiveScope } from './scope'

/** Mute, readable from anywhere. */

const hex = (seed: string): Hex => seed.repeat(64).slice(0, 64) as Hex
const ALICE = hex('a')
const BOB = hex('b')

beforeEach(() => {
  // Un-mute through the API, because the module Set is the source of truth and clearing.
  for (const pubkey of [ALICE, BOB]) {
    if (inList('muted', pubkey)) toggleList('muted', pubkey)
    if (inList('mutedReposts', pubkey)) toggleList('mutedReposts', pubkey)
  }
})

describe('isMuted', () => {
  it('answers synchronously, with no React involved', () => {
    expect(isMuted(ALICE)).toBe(false)
    toggleList('muted', ALICE)
    // The point of the whole refactor: true on the very next line, callable from a plain.
    expect(isMuted(ALICE)).toBe(true)
  })

  it('toggles back off', () => {
    toggleList('muted', ALICE)
    toggleList('muted', ALICE)
    expect(isMuted(ALICE)).toBe(false)
  })

  it('keeps the two lists independent', () => {
    // Muting reposts answers a different question: "I like this person and they amplify.
    toggleList('mutedReposts', ALICE)
    expect(isRepostMuted(ALICE)).toBe(true)
    expect(isMuted(ALICE)).toBe(false)
  })

  it('says nothing about anyone else', () => {
    toggleList('muted', ALICE)
    expect(isMuted(BOB)).toBe(false)
  })
})

describe('toggleList', () => {
  it('reports the membership AFTER the change, so a caller can label the action', () => {
    expect(toggleList('muted', ALICE)).toBe(true)
    expect(toggleList('muted', ALICE)).toBe(false)
  })

  it('persists across a reload of the stored value', () => {
    toggleList('muted', ALICE)
    // Through the per-account layer, which is where a mute lives now.
    const raw = scopedRecord('nostrich:muted')?.v
    expect(raw).not.toBeUndefined()
    expect(JSON.parse(raw as string)).toContain(ALICE)
  })
})

describe('addToList', () => {
  it('is idempotent, for callers that mean "make sure this is muted"', () => {
    // Report-and-mute must not un-mute somebody already muted.
    addToList('muted', ALICE)
    addToList('muted', ALICE)
    expect(isMuted(ALICE)).toBe(true)
    expect(listMembers('muted').filter(pubkey => pubkey === ALICE)).toHaveLength(1)
  })
})

describe('you cannot mute yourself', () => {
  /** Reported, and there is no sequence of taps that asks for it: a reader muted. */
  const ME = hex('c')

  it('reports false for the signed-in account, even with the entry stored', () => {
    // Muted while somebody else was signed in, which is exactly how the reported state.
    setActiveScope(ALICE)
    toggleList('muted', ME)
    expect(isMuted(ME)).toBe(true)

    setActiveScope(ME)
    expect(isMuted(ME)).toBe(false)
    expect(isRepostMuted(ME)).toBe(false)
    expect(inList('muted', ME)).toBe(false)

    // Still true for everyone else: this disregards one entry, it does not empty the list.
    setActiveScope(ALICE)
    expect(isMuted(ME)).toBe(true)
    toggleList('muted', ME)
    setActiveScope(undefined)
  })

  it('never PUBLISHES itself, so the damage cannot leave this device', () => {
    /* `mute-sync` builds the reader's kind-10000 from `listMembers`. */
    setActiveScope(ALICE)
    toggleList('muted', ME)
    setActiveScope(ME)
    expect(listMembers('muted')).not.toContain(ME)
    setActiveScope(ALICE)
    expect(listMembers('muted')).toContain(ME)
    toggleList('muted', ME)
    setActiveScope(undefined)
  })

  it('refuses to store the entry in the first place', () => {
    setActiveScope(ME)
    toggleList('muted', ME)
    expect(listMembers('muted')).not.toContain(ME)
    addToList('mutedReposts', ME)
    expect(listMembers('mutedReposts')).not.toContain(ME)
    setActiveScope(undefined)
  })

  it('still lets a signed-OUT reader mute anybody', () => {
    // `anon` is not an account, so nothing is "self" while nobody is signed.
    setActiveScope(undefined)
    toggleList('muted', BOB)
    expect(isMuted(BOB)).toBe(true)
    toggleList('muted', BOB)
  })
})

describe('the signed-out mute list belongs to ONE identity', () => {
  /** The cause of the bug above, and the more damaging half. */
  const CAROL = hex('d')

  function accountsOnDevice(count: number): void {
    localStorage.setItem(
      'nostrich.accounts',
      JSON.stringify({ accounts: Array.from({ length: count }, (_, i) => ({ pubkey: hex(String(i)) })) }),
    )
  }

  it('a SECOND account starts with its own empty list', async () => {
    localStorage.clear()
    setActiveScope(undefined)
    const lists = await import('./user-lists')

    // Built up while signed out.
    lists.toggleList('muted', CAROL)
    expect(lists.isMuted(CAROL)).toBe(true)

    // A device that already holds two identities: this is somebody's second account.
    accountsOnDevice(2)
    setActiveScope(BOB)
    expect(lists.isMuted(CAROL)).toBe(false)

    setActiveScope(undefined)
    localStorage.clear()
  })
})

describe('un-muting has to survive the sync', () => {
  /** The bug that made the button look broken. */
  const DAVE = hex('e')

  it('records a tombstone when an account is un-muted', () => {
    setActiveScope(undefined)
    toggleList('muted', DAVE)
    expect(inList('unmuted', DAVE)).toBe(false)

    toggleList('muted', DAVE)
    expect(isMuted(DAVE)).toBe(false)
    expect(inList('unmuted', DAVE)).toBe(true)
  })

  it('clears the tombstone when they are muted again', () => {
    // A tombstone means "I removed this".
    setActiveScope(undefined)
    toggleList('muted', DAVE)
    expect(inList('unmuted', DAVE)).toBe(false)
    toggleList('muted', DAVE)
  })

  it('leaves no tombstone for reposts, which are never published', () => {
    setActiveScope(undefined)
    toggleList('mutedReposts', BOB)
    toggleList('mutedReposts', BOB)
    expect(inList('unmuted', BOB)).toBe(false)
  })
})
