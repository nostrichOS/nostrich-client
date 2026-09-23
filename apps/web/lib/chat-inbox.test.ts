import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, DecryptedDirectMessage, Hex } from '@nostrich/nostr'

import { splitInbox } from './chat-inbox'
import { acceptRequest, deleteRequest, restoreRequest } from './chat-requests'

/** Inbox versus requests. */

const key = (i: number): Hex => (i + 16).toString(16).padStart(2, '0').repeat(32) as Hex

const SELF = key(0)
const FRIEND = key(1)
const STRANGER = key(2)
const OTHER_STRANGER = key(3)

function conversation(participants: Hex[], unreadCount = 0): Conversation {
  return {
    key: [...participants].sort().join(':'),
    participants,
    lastMessageAt: 1_800_000_000,
    unreadCount,
  }
}

function message(sender: Hex, participants: Hex[]): DecryptedDirectMessage {
  return {
    id: '11'.repeat(32) as Hex,
    senderPubkey: sender,
    participants,
    content: 'hello',
    createdAt: 1_800_000_000,
    wrapId: '22'.repeat(32) as Hex,
  }
}

const known = (pubkey: Hex): boolean => pubkey === FRIEND

describe('splitInbox', () => {
  it('puts someone you know in the inbox', () => {
    const chat = conversation([SELF, FRIEND])
    const split = splitInbox([chat], {
      self: SELF,
      messagesByConversation: new Map(),
      known,
    })
    expect(split.inbox).toHaveLength(1)
    expect(split.requests).toHaveLength(0)
  })

  it('files an unknown sender as a request', () => {
    const chat = conversation([SELF, STRANGER])
    const split = splitInbox([chat], {
      self: SELF,
      messagesByConversation: new Map(),
      known,
    })
    expect(split.requests).toHaveLength(1)
    expect(split.inbox).toHaveLength(0)
  })

  it('never drops a conversation', () => {
    // A DM is addressed mail.
    const all = [
      conversation([SELF, FRIEND]),
      conversation([SELF, STRANGER]),
      conversation([SELF, OTHER_STRANGER]),
    ]
    const split = splitInbox(all, { self: SELF, messagesByConversation: new Map(), known })
    expect(split.inbox.length + split.requests.length).toBe(all.length)
  })

  it('promotes a stranger permanently once you have replied', () => {
    // The strongest signal available and it is free.
    const chat = conversation([SELF, STRANGER])
    const messages = new Map([[chat.key, [message(STRANGER, [SELF, STRANGER]), message(SELF, [SELF, STRANGER])]]])

    const split = splitInbox([chat], { self: SELF, messagesByConversation: messages, known })

    expect(split.inbox).toHaveLength(1)
    expect(split.requests).toHaveLength(0)
  })

  it('does not promote a conversation the stranger did all the talking in', () => {
    const chat = conversation([SELF, STRANGER])
    const messages = new Map([[chat.key, [message(STRANGER, [SELF, STRANGER]), message(STRANGER, [SELF, STRANGER])]]])

    const split = splitInbox([chat], { self: SELF, messagesByConversation: messages, known })

    expect(split.requests).toHaveLength(1)
  })

  it('keeps requests out of the badge entirely', () => {
    // The whole point: a stranger must not be able to light the dot on somebody's phone.
    const all = [conversation([SELF, FRIEND], 2), conversation([SELF, STRANGER], 99)]
    const split = splitInbox(all, { self: SELF, messagesByConversation: new Map(), known })

    expect(split.inboxUnread).toBe(2)
    // Counted, shown on its own tab, but never in the main badge.
    expect(split.requestUnread).toBe(99)
  })

  it('treats a group containing anyone you know as an introduction', () => {
    // Being added to a group by somebody you follow IS the introduction.
    const chat = conversation([SELF, FRIEND, STRANGER, OTHER_STRANGER])
    const split = splitInbox([chat], { self: SELF, messagesByConversation: new Map(), known })
    expect(split.inbox).toHaveLength(1)
  })

  it('files a group of complete strangers as a request', () => {
    const chat = conversation([SELF, STRANGER, OTHER_STRANGER])
    const split = splitInbox([chat], { self: SELF, messagesByConversation: new Map(), known })
    expect(split.requests).toHaveLength(1)
  })

  it('leaves the inbox undivided when signed out', () => {
    // No graph and no history to consult, so nothing can be judged.
    const all = [conversation([STRANGER, OTHER_STRANGER], 3)]
    const split = splitInbox(all, { messagesByConversation: new Map(), known })

    expect(split.inbox).toHaveLength(1)
    expect(split.requests).toHaveLength(0)
    expect(split.inboxUnread).toBe(3)
  })

  it('keeps a note to self in the inbox', () => {
    const chat = conversation([SELF])
    const split = splitInbox([chat], { self: SELF, messagesByConversation: new Map(), known })
    expect(split.inbox).toHaveLength(1)
  })
})

/** The reader overruling the split. */
describe('accept and delete', () => {
  const chat = conversation([SELF, STRANGER], 4)
  const options = { self: SELF, messagesByConversation: new Map(), known }

  beforeEach(() => {
    restoreRequest(chat.key)
  })

  it('moves an accepted request into the inbox', () => {
    expect(splitInbox([chat], options).requests).toHaveLength(1)
    acceptRequest(chat.key)
    expect(splitInbox([chat], options).inbox).toHaveLength(1)
  })

  it('counts an accepted conversation toward the badge, like any other', () => {
    acceptRequest(chat.key)
    expect(splitInbox([chat], options).inboxUnread).toBe(4)
  })

  it('keeps an accepted conversation even if the sender is still a stranger', () => {
    // Accepting outranks the graph, so it survives a re-crawl or an un-follow.
    acceptRequest(chat.key)
    const split = splitInbox([chat], { ...options, known: () => false })
    expect(split.inbox).toHaveLength(1)
  })

  it('removes a deleted request from both lists', () => {
    deleteRequest(chat.key)
    const split = splitInbox([chat], options)
    expect(split.inbox).toHaveLength(0)
    expect(split.requests).toHaveLength(0)
    // And it takes its unread with it, so a deleted request cannot keep a badge lit.
    expect(split.requestUnread).toBe(0)
  })

  it('lets accepting undo a delete', () => {
    // The two are mutually exclusive.
    deleteRequest(chat.key)
    acceptRequest(chat.key)
    expect(splitInbox([chat], options).inbox).toHaveLength(1)
  })

  it('restores a conversation to being an undecided request', () => {
    deleteRequest(chat.key)
    restoreRequest(chat.key)
    expect(splitInbox([chat], options).requests).toHaveLength(1)
  })
})
