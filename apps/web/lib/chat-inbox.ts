'use client'

import { useMemo } from 'react'
import type { Conversation, DecryptedDirectMessage, Hex } from '@nostrich/nostr'

import { useChat } from './chat'
import { useFollows } from './contacts'
import { isAccepted, isDeletedRequest, useChatRequestsVersion } from './chat-requests'
import { useSocialGraph } from './social-graph'
import { useVerifiedSenders } from './verified-senders'

/** Which conversations belong in the inbox, and which are requests. */

export interface InboxSplit {
  /** Conversations that behave exactly as they do today, badge included. */
  inbox: Conversation[]
  /** Listed and readable, but contributing nothing to the unread count. */
  requests: Conversation[]
  /** Requests from strangers who are not NIP-05 verified, counted nowhere. */
  hidden: Conversation[]
  /** Unread across the inbox only. */
  inboxUnread: number
  /** Unread across requests. Shown ON the Requests tab, never in the main badge. */
  requestUnread: number
}

export interface InboxOptions {
  self?: Hex
  /** Every message in each conversation, keyed as `Conversation.key`. */
  messagesByConversation: Map<string, DecryptedDirectMessage[]>
  /** Whether the reader has any standing relationship with this account. */
  known: (pubkey: Hex) => boolean
  /** Whether this account's NIP-05 checks out; without it no request is hidden. */
  verified?: (pubkey: Hex) => boolean
  /** Proven to have no profile at all; a request from only such strangers is not listed. */
  nobody?: (pubkey: Hex) => boolean
}

/** Whether the reader has ever written into this conversation. */
function hasReplied(messages: readonly DecryptedDirectMessage[] | undefined, self: Hex): boolean {
  if (messages === undefined) return false
  return messages.some(message => message.senderPubkey === self)
}

export function splitInbox(
  conversations: readonly Conversation[],
  options: InboxOptions,
): InboxSplit {
  const { self, messagesByConversation, known, verified, nobody } = options

  const inbox: Conversation[] = []
  const requests: Conversation[] = []
  const hidden: Conversation[] = []

  for (const conversation of conversations) {
    // Signed out there is no graph and no history to consult, so nothing can be judged.
    if (self === undefined) {
      inbox.push(conversation)
      continue
    }

    /** The reader's own decision, which outranks every guess below. */
    if (isDeletedRequest(conversation.key)) continue
    if (isAccepted(conversation.key)) {
      inbox.push(conversation)
      continue
    }

    if (hasReplied(messagesByConversation.get(conversation.key), self)) {
      inbox.push(conversation)
      continue
    }

    /** A group is judged by whether ANY participant is known. */
    const others = conversation.participants.filter(participant => participant !== self)
    if (others.length === 0 || others.some(known)) inbox.push(conversation)
    // A stranger with no profile anywhere is kept out of Chat.
    else if (nobody !== undefined && others.every(nobody)) continue
    // A stranger who is not NIP-05 verified goes to Hidden requests.
    else if (verified !== undefined && !others.some(verified)) hidden.push(conversation)
    else requests.push(conversation)
  }

  return {
    inbox,
    requests,
    hidden,
    inboxUnread: inbox.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    requestUnread: requests.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
  }
}

/** The split, wired to this reader's graph. */
export function useInboxSplit(self: Hex | undefined): InboxSplit {
  const chat = useChat(self)
  const graph = useSocialGraph(self, { eager: false })
  // The reader's own contact list.
  const follows = useFollows(self)
  /** `all`, never `authors`, and a Set rather than a scan. */
  const followed = useMemo(() => new Set(follows.all), [follows.all])
  // Accepting or deleting a request has to move it immediately, not on the next.
  const decisions = useChatRequestsVersion()

  const base = useMemo(
    () => ({
      ...(self === undefined ? {} : { self }),
      messagesByConversation: chat.messagesByConversation,
      known: (pubkey: Hex) =>
        followed.has(pubkey) || (graph.ready && graph.distance(pubkey) <= 2),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decisions is the signal
    [chat.messagesByConversation, self, graph, followed, decisions],
  )
  // Every other participant of a request, whose NIP-05 decides between Requests and Hidden.
  const strangers = useMemo(() => {
    const unsorted = splitInbox(chat.conversations, base).requests
    return [...new Set(unsorted.flatMap(conversation => conversation.participants.filter(pubkey => pubkey !== self)))]
  }, [chat.conversations, base, self])
  const senders = useVerifiedSenders(strangers)

  return useMemo(
    () => splitInbox(chat.conversations, { ...base, verified: senders.verified, nobody: senders.nobody }),
    [chat.conversations, base, senders],
  )
}
