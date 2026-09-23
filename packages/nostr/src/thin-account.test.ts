import { describe, expect, it } from 'vitest'

import { authoredCounts, countsAreUsable, followingCount, isThinAccount, newestContacts } from './thin-account'
import type { NostrEvent } from './types'

/** The rule that decides whether an account may put a mention in front of a stranger. */

const rich = { hasPicture: true, nip05Verified: false, rootNotes: 0, replies: 0 }
const bare = { hasPicture: false, nip05Verified: false, rootNotes: 0, replies: 0 }

const note = (id: string, pubkey: string, reply = false): NostrEvent =>
  ({
    id,
    pubkey,
    kind: 1,
    created_at: 1,
    content: '',
    sig: '',
    tags: reply ? [['e', 'x'.repeat(64)]] : [],
  }) as NostrEvent

describe('isThinAccount', () => {
  it('CONDEMNS an account whose only credential is a picture', () => {
    /* This asserted the opposite until 2026-09-04, and that assertion was the bug. */
    expect(isThinAccount({ hasPicture: true, nip05Verified: false, rootNotes: 3, replies: 0 })).toBe(true)
  })

  it('still clears a picture once there is a history behind it', () => {
    // The counts are what decide it now, and a real account passes them.
    expect(
      isThinAccount({ hasPicture: true, nip05Verified: false, rootNotes: 40, replies: 40 }),
    ).toBe(false)
  })

  it('clears a verified NIP-05 with no picture and no history', () => {
    // The deliberate escape hatch: the one claim on Nostr somebody else's DNS.
    expect(isThinAccount({ ...bare, nip05Verified: true })).toBe(false)
  })

  it('condemns the burst that prompted it: no profile, one note', () => {
    expect(isThinAccount({ ...bare, rootNotes: 1, replies: 0 })).toBe(true)
  })

  it('needs BOTH counts to clear, not either', () => {
    // "no profile picture + either one".
    expect(isThinAccount({ ...bare, rootNotes: 500, replies: 3 })).toBe(true)
    expect(isThinAccount({ ...bare, rootNotes: 2, replies: 500 })).toBe(true)
    expect(isThinAccount({ ...bare, rootNotes: 11, replies: 11 })).toBe(false)
  })

  it('treats exactly ten as too few, the threshold is EXCEEDED, not met', () => {
    expect(isThinAccount({ ...bare, rootNotes: 10, replies: 10 })).toBe(true)
  })
})

describe('authoredCounts', () => {
  const ME = 'a'.repeat(64)
  const OTHER = 'b'.repeat(64)

  it('separates roots from replies', () => {
    const counts = authoredCounts([note('1', ME), note('2', ME, true), note('3', ME, true)], ME)
    expect(counts).toEqual({ rootNotes: 1, replies: 2 })
  })

  it('counts a note ONCE however many relays returned it', () => {
    /* The half that fails silently. */
    const dup = [note('1', ME), note('1', ME), note('1', ME)]
    expect(authoredCounts(dup, ME)).toEqual({ rootNotes: 1, replies: 0 })
  })

  it('ignores everybody else’s notes', () => {
    expect(authoredCounts([note('1', OTHER), note('2', ME)], ME)).toEqual({
      rootNotes: 1,
      replies: 0,
    })
  })
})

describe('countsAreUsable', () => {
  it('refuses to act on an empty answer', () => {
    /* Seeing nothing is not a count of zero. */
    expect(countsAreUsable({ rootNotes: 0, replies: 0 })).toBe(false)
    expect(countsAreUsable({ rootNotes: 1, replies: 0 })).toBe(true)
  })
})

/** FOLLOWING. */
const established = { hasPicture: false, nip05Verified: false, rootNotes: 40, replies: 40 }

describe('the following test', () => {
  it('condemns an established-looking account that follows nobody', () => {
    // The shape it exists for: a farm that bothered to manufacture history still.
    expect(isThinAccount({ ...established, following: 0 })).toBe(true)
  })

  it('treats exactly ten as too few, matching the note thresholds', () => {
    expect(isThinAccount({ ...established, following: 10 })).toBe(true)
    expect(isThinAccount({ ...established, following: 11 })).toBe(false)
  })

  it('clears the legitimate mentioner that was measured against it', () => {
    expect(isThinAccount({ ...established, following: 893 })).toBe(false)
  })

  it('does NOT condemn on undefined, the outage case', () => {
    /* The single most important assertion in this file. */
    expect(isThinAccount({ ...established, following: undefined })).toBe(false)
    expect(isThinAccount(established)).toBe(false)
  })

  it('cannot rescue an account the note counts already condemned', () => {
    // Following thousands is not a way to buy your way past having no history.
    expect(isThinAccount({ ...bare, following: 5_000 })).toBe(true)
  })

  it('is never reached when a verified NIP-05 clears the account', () => {
    expect(isThinAccount({ ...bare, nip05Verified: true, following: 0 })).toBe(false)
  })
})

describe('followingCount', () => {
  const contacts = (ps: string[], at = 1): NostrEvent =>
    ({
      id: 'c'.repeat(64), pubkey: 'a'.repeat(64), kind: 3, created_at: at,
      content: '', sig: '', tags: ps.map(p => ['p', p]),
    }) as NostrEvent

  it('counts the p tags', () => {
    expect(followingCount(contacts(['a', 'b', 'c']))).toBe(3)
  })

  it('DEDUPES, a padded list must not buy a pass', () => {
    expect(followingCount(contacts(['a', 'a', 'a', 'a', 'b']))).toBe(2)
  })

  it('reads an empty list as zero, which is a real answer', () => {
    expect(followingCount(contacts([]))).toBe(0)
  })

  it('reads a MISSING list as undefined, which is not', () => {
    // The caller decides whether missing means "publishes no kind-3" or "the relays.
    expect(followingCount(undefined)).toBeUndefined()
  })
})

describe('newestContacts', () => {
  const list = (pubkey: string, at: number, ps: string[]): NostrEvent =>
    ({
      id: `${pubkey}-${at}`, pubkey, kind: 3, created_at: at,
      content: '', sig: '', tags: ps.map(p => ['p', p]),
    }) as NostrEvent

  it('keeps the newest when a relay returns several versions', () => {
    // Replaceable, but relays are entitled to hand back an old one.
    const out = newestContacts([list('a', 900, ['x', 'y']), list('a', 100, [])])
    expect(followingCount(out.get('a'))).toBe(2)
  })

  it('keeps the newest whichever order it arrives in', () => {
    const out = newestContacts([list('a', 100, []), list('a', 900, ['x', 'y'])])
    expect(followingCount(out.get('a'))).toBe(2)
  })

  it('ignores anything that is not a contact list', () => {
    expect(newestContacts([note('n1', 'a')]).size).toBe(0)
  })

  it('has no entry for an author who returned none', () => {
    expect(newestContacts([]).get('a')).toBeUndefined()
  })
})
