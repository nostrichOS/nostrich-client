import { beforeEach, describe, expect, it } from 'vitest'
import type { Hex } from '@nostrich/nostr'

import { MIN_TO_FOLD, rankReplies, type ReplyNode } from './thread-ranking'
import { toggleList } from './user-lists'

/** Threads are the one surface where hiding is wrong. */

const hex = (seed: string): Hex => seed.repeat(64).slice(0, 64) as Hex

const AUTHOR = hex('a')
const VIEWER = hex('b')
const STRANGER = hex('c')

let counter = 0
function reply(pubkey: Hex): ReplyNode {
  counter += 1
  return { event: { id: String(counter), pubkey, created_at: counter }, children: [] }
}

// The mute store is a module-level Set loaded once at import, so clearing.
beforeEach(() => {
  localStorage.clear()
})

describe('rankReplies', () => {
  it('shows everything when nothing is low signal', () => {
    const replies = [reply(AUTHOR), reply(STRANGER)]
    const result = rankReplies(replies, { threadAuthor: AUTHOR, viewer: VIEWER })
    expect(result.shown).toHaveLength(2)
    expect(result.folded).toHaveLength(0)
  })

  it('folds low-signal replies once there are enough to be worth folding', () => {
    const low = [hex('d'), hex('e'), hex('f')]
    const replies = [reply(AUTHOR), ...low.map(pubkey => reply(pubkey))]

    const result = rankReplies(replies, {
      threadAuthor: AUTHOR,
      isLowSignal: pubkey => low.includes(pubkey),
    })

    expect(result.folded).toHaveLength(MIN_TO_FOLD)
    expect(result.shown.map(node => node.event.pubkey)).toEqual([AUTHOR])
  })

  it('leaves one or two low-signal replies in place', () => {
    // The disclosure row would cost more attention than the replies it hides.
    const replies = [reply(AUTHOR), reply(STRANGER), reply(STRANGER)]
    const result = rankReplies(replies, {
      threadAuthor: AUTHOR,
      isLowSignal: pubkey => pubkey === STRANGER,
    })
    expect(result.folded).toHaveLength(0)
    expect(result.shown).toHaveLength(3)
  })

  it('never folds the thread author, however they score', () => {
    const replies = [reply(AUTHOR), reply(AUTHOR), reply(AUTHOR), reply(AUTHOR)]
    const result = rankReplies(replies, {
      threadAuthor: AUTHOR,
      isLowSignal: () => true,
    })
    expect(result.folded).toHaveLength(0)
  })

  it('never folds the reader themselves', () => {
    const replies = [reply(VIEWER), reply(VIEWER), reply(VIEWER), reply(VIEWER)]
    const result = rankReplies(replies, { viewer: VIEWER, isLowSignal: () => true })
    expect(result.folded).toHaveLength(0)
  })

  it('folds a muted author rather than removing them', () => {
    // You may need to see what you muted to understand the replies.
    const muted = hex('d')
    toggleList('muted', muted)
    const replies = [reply(AUTHOR), reply(muted), reply(muted), reply(muted)]

    const result = rankReplies(replies, { threadAuthor: AUTHOR })

    expect(result.folded).toHaveLength(3)
    // Nothing was dropped: every reply is still accounted for somewhere.
    expect(result.shown.length + result.folded.length).toBe(replies.length)
    toggleList('muted', muted)
  })

  it('never loses a reply, whatever the partition', () => {
    const low = [hex('d'), hex('e'), hex('f')]
    const replies = [reply(AUTHOR), reply(VIEWER), ...low.map(p => reply(p)), reply(STRANGER)]
    const result = rankReplies(replies, {
      threadAuthor: AUTHOR,
      viewer: VIEWER,
      isLowSignal: pubkey => low.includes(pubkey),
    })
    expect(result.shown.length + result.folded.length).toBe(replies.length)
  })
})

/** The lone spam reply that `MIN_TO_FOLD` used to hand straight back. */
describe('rankReplies, a decision is not subject to the count', () => {
  it('folds a single advertising reply, alone', () => {
    const spam = reply(STRANGER)
    const result = rankReplies([reply(AUTHOR), spam], {
      threadAuthor: AUTHOR,
      viewer: VIEWER,
      isHidden: node => node === spam,
    })
    expect(result.folded).toEqual([spam])
    expect(result.shown).toHaveLength(1)
  })

  it('folds a single MUTED reply, alone', () => {
    // Mute is the reader's own instruction.
    const muted = hex('d')
    toggleList('muted', muted)
    const hidden = reply(muted)
    const result = rankReplies([reply(AUTHOR), hidden], { threadAuthor: AUTHOR, viewer: VIEWER })
    expect(result.folded).toEqual([hidden])
    toggleList('muted', muted)
  })

  it('still puts back one or two GUESSES, which is what the threshold is for', () => {
    // "No profile we can read" on a single reply is not worth a disclosure row.
    const quiet = reply(STRANGER)
    const result = rankReplies([reply(AUTHOR), quiet], {
      threadAuthor: AUTHOR,
      viewer: VIEWER,
      isLowSignal: pubkey => pubkey === STRANGER,
    })
    expect(result.folded).toHaveLength(0)
    expect(result.shown).toHaveLength(2)
  })

  it('folds the guesses too once something definite is already folded', () => {
    // The row is being paid for anyway, so the uncertain ones may as well go behind.
    const spam = reply(STRANGER)
    const quiet = reply(hex('e'))
    const result = rankReplies([reply(AUTHOR), spam, quiet], {
      threadAuthor: AUTHOR,
      viewer: VIEWER,
      isHidden: node => node === spam,
      isLowSignal: pubkey => pubkey === hex('e'),
    })
    expect(result.folded).toHaveLength(2)
  })

  it('never folds the thread author or the reader, whatever the verdict says', () => {
    const mine = reply(VIEWER)
    const theirs = reply(AUTHOR)
    const result = rankReplies([theirs, mine], {
      threadAuthor: AUTHOR,
      viewer: VIEWER,
      isHidden: () => true,
    })
    expect(result.folded).toHaveLength(0)
  })
})
