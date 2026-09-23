import { beforeEach, describe, expect, it } from 'vitest'
import { mergeMutes, parseMuteTags, type MuteList, type NostrEvent } from '@nostrich/nostr'

import { adoptTerms, reconcileTerms, withLocalTerms, withoutUnmuted } from './mute-sync'
import { isMutedContent } from './muted-content'
import { addTerm, removeTerm, termMembers, toggleList } from './user-lists'

/** "If I already mute a hashtag or a word in another client, does it show up here?". */

const note = (over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: '0'.repeat(64),
    pubkey: '1'.repeat(64),
    kind: 1,
    created_at: 1_700_000_000,
    content: '',
    tags: [],
    sig: '',
    ...over,
  }) as NostrEvent

const clear = (): void => {
  for (const term of termMembers('mutedWords')) removeTerm('mutedWords', term)
  for (const term of termMembers('mutedHashtags')) removeTerm('mutedHashtags', term)
}

beforeEach(clear)

describe('adoptTerms', () => {
  it('takes hashtags and words from the PUBLIC half', () => {
    // What a reader arriving from another client has: plaintext tags.
    const list: MuteList = {
      publicItems: parseMuteTags([
        ['p', '2'.repeat(64)],
        ['t', 'Politics'],
        ['word', 'AIRDROP'],
      ]),
      privateItems: [],
    }
    adoptTerms(list)
    expect(termMembers('mutedHashtags')).toEqual(['politics'])
    expect(termMembers('mutedWords')).toEqual(['airdrop'])
  })

  it('takes them from the ENCRYPTED half too', () => {
    // Mutes made in this app land in the private half, so for our own readers.
    adoptTerms({ publicItems: [], privateItems: parseMuteTags([['t', 'nsfw'], ['word', 'giveaway']]) })
    expect(termMembers('mutedHashtags')).toEqual(['nsfw'])
    expect(termMembers('mutedWords')).toEqual(['giveaway'])
  })

  it('makes the adopted terms actually filter, not just appear in a list', () => {
    adoptTerms({ publicItems: parseMuteTags([['word', 'airdrop']]), privateItems: [] })
    expect(isMutedContent(note({ content: 'free airdrop today' }))).toBe(true)
  })

  it('ignores the entry types that are not terms', () => {
    // `p` is an account and `e` is a thread.
    adoptTerms({
      publicItems: parseMuteTags([['p', '2'.repeat(64)], ['e', '3'.repeat(64)]]),
      privateItems: [],
    })
    expect(termMembers('mutedHashtags')).toEqual([])
    expect(termMembers('mutedWords')).toEqual([])
  })

  it('is idempotent, so re-syncing does not duplicate anything', () => {
    const list: MuteList = { publicItems: parseMuteTags([['t', 'politics']]), privateItems: [] }
    adoptTerms(list)
    adoptTerms(list)
    expect(termMembers('mutedHashtags')).toEqual(['politics'])
  })
})

/** REMOVING A MUTED WORD HAS TO ACTUALLY REMOVE. */
describe('removing a term', () => {
  it('is expressed in what gets published', () => {
    // The publish takes the local lists as the truth for `t` and `word`, so an entry.
    clear()
    addTerm('mutedWords', 'airdrop')
    const remote: MuteList = {
      publicItems: parseMuteTags([['p', '2'.repeat(64)]]),
      privateItems: parseMuteTags([['word', 'airdrop'], ['word', 'giveaway'], ['t', 'politics']]),
    }
    // The union on its own is the bug: it carries every remote entry forward.
    expect(mergeMutes(remote, []).privateItems).toHaveLength(3)

    const published = withLocalTerms(remote)
    expect(published.privateItems.map(i => `${i.type}:${i.value}`)).toEqual(['word:airdrop'])
  })

  it('never drops a muted ACCOUNT, whatever the term lists say', () => {
    // `p` keeps the union rule.
    clear()
    const remote: MuteList = {
      publicItems: parseMuteTags([['p', '2'.repeat(64)]]),
      privateItems: parseMuteTags([['p', '3'.repeat(64)], ['word', 'airdrop']]),
    }
    const published = withLocalTerms(remote)
    expect(published.publicItems).toHaveLength(1)
    expect(published.privateItems.map(i => i.type)).toEqual(['p'])
  })

  it('takes a NEWER published list as the truth, so a removal reaches the other device', () => {
    clear()
    addTerm('mutedWords', 'airdrop')
    addTerm('mutedHashtags', 'politics')
    // The other device published a list without them.
    const authoritative = reconcileTerms({ publicItems: [], privateItems: parseMuteTags([['word', 'giveaway']]) }, 2_000)
    expect(authoritative).toBe(true)
    expect(termMembers('mutedWords')).toEqual(['giveaway'])
    expect(termMembers('mutedHashtags')).toEqual([])
  })

  it('ignores a list no newer than the last one reconciled, so nothing is lost to a stale copy', () => {
    clear()
    reconcileTerms({ publicItems: [], privateItems: parseMuteTags([['word', 'giveaway']]) }, 5_000)
    addTerm('mutedWords', 'airdrop')
    // An older copy arriving late says nothing about a word added.
    expect(reconcileTerms({ publicItems: [], privateItems: [] }, 4_000)).toBe(false)
    expect(termMembers('mutedWords')).toContain('airdrop')
  })
})

describe('withoutUnmuted', () => {
  /** The publish half of the same fix. */
  const A = 'a'.repeat(64)
  const B = 'b'.repeat(64)

  it('drops an un-muted account from BOTH halves of the list', () => {
    toggleList('muted', A as never)
    toggleList('muted', A as never) // muted, then un-muted: a tombstone
    const out = withoutUnmuted({
      publicItems: [{ type: 'p', value: A }, { type: 'p', value: B }],
      privateItems: [{ type: 'p', value: A }],
    })
    expect(out.publicItems).toEqual([{ type: 'p', value: B }])
    expect(out.privateItems).toEqual([])
  })

  it('leaves hashtags and words alone, they have their own rule', () => {
    const list = {
      publicItems: [{ type: 't' as const, value: 'bitcoin' }],
      privateItems: [{ type: 'word' as const, value: 'airdrop' }],
    }
    expect(withoutUnmuted(list)).toEqual(list)
  })

  it('is a no-op when nothing was ever un-muted', () => {
    // Muting A again clears the tombstone the test above left behind.
    toggleList('muted', A as never)
    const list = { publicItems: [{ type: 'p' as const, value: B }], privateItems: [] }
    expect(withoutUnmuted(list)).toBe(list)
    toggleList('muted', A as never)
  })
})
