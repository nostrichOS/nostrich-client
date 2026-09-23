import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Hex, NostrEvent } from '@nostrich/nostr'

/** The rule that keeps a minted key from putting a mention in somebody's notifications. */

/** kind-0s the fake relay will answer with, by author. */
const profiles = new Map<string, Record<string, unknown>>()
/** kind-1s the fake relay holds, by author. */
const notes = new Map<string, NostrEvent[]>()
/** kind-3 `p` tags the fake relay holds, by author. */
const contacts = new Map<string, string[]>()
/** Set to make the CONTACTS query alone throw. */
let contactsFail = false

const query = vi.fn(async (filters: Record<string, unknown>[]) => {
  const out: NostrEvent[] = []
  for (const filter of filters) {
    const kinds = filter.kinds as number[]
    const authors = (filter.authors as string[]) ?? []
    for (const author of authors) {
      if (kinds.includes(0)) {
        const body = profiles.get(author)
        if (body !== undefined) {
          out.push({
            id: `meta-${author}`,
            pubkey: author,
            kind: 0,
            created_at: 1_000,
            content: JSON.stringify(body),
            tags: [],
            sig: '',
          } as NostrEvent)
        }
      }
      if (kinds.includes(1)) out.push(...(notes.get(author) ?? []))
      if (kinds.includes(3)) {
        const ps = contacts.get(author)
        if (ps !== undefined) {
          out.push({
            id: `contacts-${author}`,
            pubkey: author,
            kind: 3,
            created_at: 1_000,
            content: '',
            tags: ps.map(p => ['p', p]),
            sig: '',
          } as NostrEvent)
        }
      }
    }
  }
  return out
})

vi.mock('./pool', () => ({
  getPool: () => ({
    query: async (filters: Record<string, unknown>[]) => {
      // Only the contacts REQ fails, which is the case the rule has to survive: the notes.
      if (contactsFail && (filters[0]?.kinds as number[] | undefined)?.includes(3)) {
        throw new Error('relay outage')
      }
      return query(filters)
    },
  }),
}))

const { forgetThinMentions, isThinMentioner, judgeMentioners, unjudged } = await import(
  './thin-mentions'
)
const { rememberContacts } = await import('./contacts')
const { writeCachedNip05 } = await import('./profile-cache')

const key = (n: number): Hex => n.toString(16).padStart(64, '0') as Hex

const ME = key(1)

/** `roots` root notes and `replies` replies for one author, as the relays would return. */
function history(author: Hex, roots: number, replies: number): void {
  const out: NostrEvent[] = []
  for (let i = 0; i < roots; i += 1) {
    out.push({
      id: `${author}-root-${i}`,
      pubkey: author,
      kind: 1,
      created_at: 2_000 + i,
      content: 'a note',
      tags: [],
      sig: '',
    } as NostrEvent)
  }
  for (let i = 0; i < replies; i += 1) {
    out.push({
      id: `${author}-reply-${i}`,
      pubkey: author,
      kind: 1,
      created_at: 3_000 + i,
      content: 'a reply',
      tags: [['e', key(900)]],
      sig: '',
    } as NostrEvent)
  }
  notes.set(author, out)
}

/** A contact list of `n` follows for one author. */
function following(author: Hex, n: number): void {
  contacts.set(author, Array.from({ length: n }, (_, i) => key(500 + i)))
}

beforeEach(() => {
  profiles.clear()
  notes.clear()
  contacts.clear()
  contactsFail = false
  query.mockClear()
  forgetThinMentions()
  localStorage.clear()
})

describe('isThinMentioner', () => {
  it('shows an account nobody has judged', () => {
    // The whole rule fails open.
    expect(isThinMentioner(key(2), ME)).toBe(false)
  })

  it('never judges the reader themselves', async () => {
    history(ME, 0, 0)
    await judgeMentioners([ME], ME)
    expect(isThinMentioner(ME, ME)).toBe(false)
  })
})

describe('judgeMentioners', () => {
  it('hides the burst that prompted this rule: no profile, one note', async () => {
    // The measured shape.
    const spammer = key(2)
    history(spammer, 1, 0)
    await judgeMentioners([spammer], ME)
    expect(isThinMentioner(spammer, ME)).toBe(true)
  })

  it('IGNORES an account whose only credential is a picture', async () => {
    /* This asserted the opposite, and the assertion was the bug. */
    const author = key(3)
    profiles.set(author, { name: 'someone', picture: 'https://example.com/a.png' })
    history(author, 1, 0)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(true)
  })

  it('shows an account with a picture once there is a history behind it', async () => {
    // The counts decide it now, and a real account passes them.
    const author = key(9)
    profiles.set(author, { name: 'someone', picture: 'https://example.com/a.png' })
    history(author, 40, 40)
    following(author, 200)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(false)
  })

  it('a picture is not evidence either way, thin is decided by the counts', async () => {
    const author = key(4)
    profiles.set(author, { name: 'someone', picture: '   ' })
    history(author, 1, 0)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(true)
  })

  it('shows an account whose NIP-05 verifies, with no picture and no history', async () => {
    const author = key(5)
    profiles.set(author, { name: 'someone', nip05: 'someone@example.com' })
    // A remembered PASS is what the rule reads.
    writeCachedNip05(author, 'someone@example.com', true)
    history(author, 0, 0)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(false)
  })

  it('does NOT accept a NIP-05 claim that fails to verify', async () => {
    /* The rule's whole value rests. */
    const author = key(6)
    profiles.set(author, { name: 'someone', nip05: 'liar@example.com' })
    writeCachedNip05(author, 'liar@example.com', false)
    history(author, 1, 0)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(true)
  })

  it('shows an account that clears BOTH counts and follows people', async () => {
    const author = key(7)
    history(author, 11, 11)
    following(author, 11)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(false)
  })

  it('hides an account that clears only one count', async () => {
    /* "no profile picture + either one". */
    const broadcaster = key(8)
    history(broadcaster, 500, 3)
    await judgeMentioners([broadcaster], ME)
    expect(isThinMentioner(broadcaster, ME)).toBe(true)

    const replier = key(9)
    history(replier, 2, 500)
    await judgeMentioners([replier], ME)
    expect(isThinMentioner(replier, ME)).toBe(true)
  })

  it('treats exactly ten as too few, the threshold is EXCEEDED, not met', async () => {
    const author = key(10)
    history(author, 10, 10)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(true)
  })

  it('counts a note once however many relays return it', async () => {
    /* `pool.query` unions across relays, so the same note arrives once per relay. */
    const author = key(11)
    history(author, 4, 4)
    const held = notes.get(author) ?? []
    // Three relays holding the same eight notes.
    notes.set(author, [...held, ...held, ...held])
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(true)
  })

  it('leaves an account unjudged when the relays answer nothing', async () => {
    // A relay outage must not read as "this account has no history".
    query.mockImplementationOnce(async () => {
      throw new Error('relays down')
    })
    const author = key(12)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(false)
  })

  it('leaves an account unjudged when no note of theirs comes back', async () => {
    /* Distinct from the throw above, and the more likely failure: the query RESOLVES. */
    const author = key(19)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(false)
  })
})

describe('follows', () => {
  it('never hides somebody the reader follows, even with a thin verdict on file', async () => {
    const friend = key(13)
    history(friend, 1, 0)
    await judgeMentioners([friend], ME)
    // Judged thin for a reader who does not follow them.
    expect(isThinMentioner(friend, key(99))).toBe(true)

    rememberContacts({
      id: 'contacts-1',
      pubkey: ME,
      kind: 3,
      created_at: 5_000,
      content: '',
      tags: [['p', friend]],
      sig: '',
    } as NostrEvent)

    // ...and never for the reader who does.
    expect(isThinMentioner(friend, ME)).toBe(false)
  })
})

describe('unjudged', () => {
  it('skips the reader, their follows, and anyone already decided', async () => {
    const decided = key(14)
    const stranger = key(15)
    const friend = key(16)
    history(decided, 1, 0)
    await judgeMentioners([decided], ME)
    rememberContacts({
      id: 'contacts-2',
      pubkey: ME,
      kind: 3,
      created_at: 6_000,
      content: '',
      tags: [['p', friend]],
      sig: '',
    } as NostrEvent)

    expect(unjudged([ME, decided, friend, stranger], ME)).toEqual([stranger])
  })

  it('returns each candidate once', () => {
    const stranger = key(17)
    expect(unjudged([stranger, stranger, stranger], ME)).toEqual([stranger])
  })

  it('costs no request when everything is already decided', async () => {
    const author = key(18)
    history(author, 1, 0)
    await judgeMentioners([author], ME)
    const before = query.mock.calls.length
    await judgeMentioners([author], ME)
    expect(query.mock.calls.length).toBe(before)
  })
})

/** FOLLOWING. */
describe('the following count', () => {
  it('hides an account with real history that follows nobody', async () => {
    // Both note counts pass, so this is the only test left standing.
    const author = key(30)
    profiles.set(author, { name: 'someone', picture: 'https://example.com/a.png' })
    history(author, 40, 40)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(true)
  })

  it('hides one that follows exactly ten, and shows eleven', async () => {
    const ten = key(31)
    history(ten, 40, 40)
    following(ten, 10)
    const eleven = key(32)
    history(eleven, 40, 40)
    following(eleven, 11)
    await judgeMentioners([ten, eleven], ME)
    expect(isThinMentioner(ten, ME)).toBe(true)
    expect(isThinMentioner(eleven, ME)).toBe(false)
  })

  it('SHOWS everybody when the contacts query fails outright', async () => {
    /* THE ASSERTION THAT KEEPS THIS RULE HONEST. */
    contactsFail = true
    const author = key(33)
    history(author, 40, 40)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(false)
  })

  it('does not spare a historyless account for following thousands', async () => {
    // Following is a way to fail the rule, never a way to buy past the note counts.
    const author = key(34)
    history(author, 1, 0)
    following(author, 3_000)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(true)
  })

  it('never reaches the count for a verified NIP-05', async () => {
    const author = key(35)
    profiles.set(author, { name: 'someone', nip05: 'someone@example.com' })
    writeCachedNip05(author, 'someone@example.com', true)
    history(author, 40, 40)
    await judgeMentioners([author], ME)
    expect(isThinMentioner(author, ME)).toBe(false)
  })

  it('asks for contact lists in a filter of their own', async () => {
    /* `limit` is per filter under NIP-01, so kinds [1, 3] in one filter would let. */
    const author = key(36)
    history(author, 40, 40)
    following(author, 50)
    await judgeMentioners([author], ME)
    const filters = query.mock.calls.flatMap(call => call[0] as Record<string, unknown>[])
    const kindLists = filters.map(f => (f.kinds as number[]).join(','))
    expect(kindLists).toContain('3')
    expect(kindLists.some(k => k === '1,3' || k === '3,1')).toBe(false)
  })
})
