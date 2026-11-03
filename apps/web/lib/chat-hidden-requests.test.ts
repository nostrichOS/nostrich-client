import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, Hex } from '@nostrich/nostr'

// Requests from strangers who are not NIP-05 verified are hidden, and strangers with no profile are kept out.

const queried: unknown[] = []
let answer: { events: { tags: string[][] }[]; answered: number } = { events: [], answered: 1 }
let profiles: { authors: string[]; answered: number } = { authors: [], answered: 1 }
vi.mock('./pool', () => ({
  getPool: () => ({
    subscribe: () => ({ close: () => undefined }),
    readRelays: () => [],
    queryWithStatus: async (filters: { kinds: number[] }[]) => {
      queried.push(filters)
      if (filters[0]?.kinds[0] === 0) {
        return { events: profiles.authors.map(pubkey => ({ pubkey, tags: [] })), answered: profiles.answered }
      }
      return answer
    },
  }),
}))

const { splitInbox } = await import('./chat-inbox')
const { legacyCorrespondents, legacyWorthOpening } = await import('./dm-strangers')
const { acceptRequest } = await import('./chat-requests')

const key = (i: number): Hex => (i + 16).toString(16).padStart(2, '0').repeat(32) as Hex
const SELF = key(0)
const FRIEND = key(1)
const VERIFIED = key(2)
const SPAMMER = key(3)
const CORRESPONDENT = key(4)
const ACCEPTED = key(5)

const conversation = (participants: Hex[], unreadCount = 1): Conversation => ({
  key: [...participants].sort().join(':'),
  participants,
  lastMessageAt: 1_800_000_000,
  unreadCount,
})

const split = (
  conversations: Conversation[],
  verified?: (pubkey: Hex) => boolean,
  nobody?: (pubkey: Hex) => boolean,
) =>
  splitInbox(conversations, {
    self: SELF,
    messagesByConversation: new Map(),
    known: pubkey => pubkey === FRIEND,
    ...(verified === undefined ? {} : { verified }),
    ...(nobody === undefined ? {} : { nobody }),
  })

const now = Math.floor(Date.now() / 1000)
const dm = (id: number, pubkey: Hex) => ({ id: String(id).repeat(64).slice(0, 64), pubkey, created_at: now + 60 })

afterEach(() => {
  queried.length = 0
  answer = { events: [], answered: 1 }
  profiles = { authors: [], answered: 1 }
  localStorage.clear()
})

describe('hidden requests', () => {
  it('files a stranger who is not verified under hidden, and counts it nowhere', () => {
    const result = split([conversation([SELF, SPAMMER], 16)], pubkey => pubkey === VERIFIED)
    expect(result.hidden).toHaveLength(1)
    expect(result.requests).toEqual([])
    expect(result.requestUnread).toBe(0)
    expect(result.inboxUnread).toBe(0)
  })

  it('keeps a verified stranger in Requests', () => {
    const result = split([conversation([SELF, VERIFIED], 2)], pubkey => pubkey === VERIFIED)
    expect(result.requests).toHaveLength(1)
    expect(result.requestUnread).toBe(2)
  })

  it('never hides somebody the reader follows', () => {
    const result = split([conversation([SELF, FRIEND])], () => false, () => true)
    expect(result.inbox).toHaveLength(1)
  })

  it('never hides a conversation the reader accepted', () => {
    const accepted = conversation([SELF, ACCEPTED])
    acceptRequest(accepted.key)
    expect(split([accepted], () => false, () => true).inbox).toHaveLength(1)
  })

  it('hides nothing for a caller that does not judge verification', () => {
    const result = split([conversation([SELF, SPAMMER])])
    expect(result.requests).toHaveLength(1)
    expect(result.hidden).toEqual([])
  })
})

describe('strangers with no profile', () => {
  it('lists a stranger proven to have no profile nowhere', () => {
    const result = split([conversation([SELF, SPAMMER], 16)], () => false, pubkey => pubkey === SPAMMER)
    expect([...result.inbox, ...result.requests, ...result.hidden]).toEqual([])
  })

  it('keeps a group in which anybody has a profile', () => {
    const result = split([conversation([SELF, SPAMMER, CORRESPONDENT])], () => false, pubkey => pubkey === SPAMMER)
    expect(result.hidden).toHaveLength(1)
  })

  it('never opens a kind-4 from a stranger with no profile', async () => {
    profiles = { authors: [VERIFIED], answered: 3 }
    answer = { events: [{ tags: [['p', CORRESPONDENT]] }], answered: 2 }
    const opened = await legacyWorthOpening(SELF, [dm(7, SPAMMER), dm(8, VERIFIED), dm(9, CORRESPONDENT), dm(1, SELF)], [], () => false)
    expect(opened.map(event => event.pubkey).sort()).toEqual([SELF, CORRESPONDENT, VERIFIED].sort())
  })

  it('opens everything when no relay answered the profile question', async () => {
    profiles = { authors: [], answered: 0 }
    expect(await legacyWorthOpening(SELF, [dm(7, SPAMMER)], [], () => false)).toHaveLength(1)
  })

  it('never asks about a sender whose profile the device holds', async () => {
    expect(await legacyWorthOpening(SELF, [dm(7, SPAMMER)], [], () => true)).toHaveLength(1)
    expect(queried.some(filters => (filters as { kinds: number[] }[])[0]?.kinds[0] === 0)).toBe(false)
  })

  it('counts every stranger as written to when no relay answered', async () => {
    answer = { events: [], answered: 0 }
    expect(await legacyCorrespondents(SELF, [dm(2, SPAMMER)], () => false, [])).toHaveLength(1)
  })
})
