'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { useDismiss } from '../lib/dismiss'
import { Link } from './AppLink'
import { conversationKeyOf, profileDisplayName, type Conversation, type Hex } from '@nostrich/nostr'

import {
  counterpart,
  ensureDmRelayList,
  useChat,
  useChatSync,
  useMarkRead,
  type ConversationPreview,
} from '../lib/chat'
import { useInboxSplit } from '../lib/chat-inbox'
import { deleteRequest } from '../lib/chat-requests'
import { clearChatWraps } from '../lib/chat-alerts'
import { relativeTime } from '../lib/format'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { PAGE_TITLE, SCALED_BODY, TAB_ACTIVE, TAB_CELL, TAB_IDLE, TAB_LABEL, TAB_STRIP, TAB_STRIP_ROW, TAB_UNDERLINE } from '../lib/styles'
import { asset } from '../lib/assets'
import { Avatar } from './Avatar'
import { ProfileHoverCard } from './ProfileHoverCard'
import { VerifiedBadge } from './VerifiedBadge'
import { ChatConversation } from './ChatConversation'
import { ChatBubbleIcon, NewChatIcon } from './icons'
import { useNowSeconds } from './Clock'
import { NewChatModal } from './NewChatModal'
import { DmRelayNotice } from './DmRelayNotice'
import { sessionPubkey, useSession } from './SessionProvider'

/** Private messages, as a two-pane inbox. */

type FilterId = 'all' | 'unread'

export function ChatScreen(): React.ReactNode {
  const { session } = useSession()
  const self = sessionPubkey(session)
  const signer = session.status === 'signed' ? session.signer : undefined

  useChatSync(signer, self)

  /** Create a delivery list here, on the screen where private messages are the point. */
  useEffect(() => {
    if (signer === undefined || self === undefined) return
    void ensureDmRelayList(signer, self)
  }, [signer, self])
  const chat = useChat(self)
  const inbox = useInboxSplit(self)

  const router = useRouter()
  const params = useSearchParams()
  const openKey = params.get('c') ?? undefined

  const [filter, setFilter] = useState<FilterId>('all')
  const [box, setBox] = useState<'inbox' | 'requests'>('inbox')

  /** THE LAST REQUEST TAKES THE TAB WITH IT, so it must not take the reader too. */
  useEffect(() => {
    if (box === 'requests' && inbox.requests.length === 0) setBox('inbox')
  }, [box, inbox.requests.length])
  const markRead = useMarkRead()

  /** Clear every conversation. */
  const markAllRead = useCallback((): void => {
    /** The INBOX only, not requests. */
    for (const conversation of inbox.inbox) {
      if (conversation.unreadCount > 0) markRead(conversation.key, conversation.lastMessageAt)
    }
    // The arrival-based fallback counts wraps rather than messages, so it has to be told.
    clearChatWraps(self)
  }, [inbox.inbox, markRead, self])
  const [filterOpen, setFilterOpen] = useState(false)
  const filterBox = useRef<HTMLDivElement>(null)
  // Click away or press Escape.
  useDismiss(filterOpen, filterBox, useCallback(() => setFilterOpen(false), []))
  const [term, setTerm] = useState('')
  const [composing, setComposing] = useState(false)

  const open = useMemo(() => {
    if (openKey === undefined) return undefined
    const existing = chat.conversations.find(conversation => conversation.key === openKey)
    if (existing !== undefined) return existing

    /** A conversation that has not happened yet. */
    const participants = openKey.split(':').filter(part => /^[0-9a-f]{64}$/.test(part))
    if (participants.length === 0) return undefined
    return { key: openKey, participants, lastMessageAt: 0, unreadCount: 0 }
  }, [chat.conversations, openKey])

  const select = (key: string | undefined): void => {
    // replace, not push: flicking through conversations should not fill the back stack.
    router.replace(key === undefined ? '/chat' : `/chat?c=${encodeURIComponent(key)}`, {
      scroll: false,
    })
  }

  if (self === undefined || signer === undefined) {
    return (
      <div className="px-4 pt-4 sm:px-5">
        <h1 className={PAGE_TITLE}>Chat</h1>
        <p className={`mt-4 ${SCALED_BODY} text-text-muted`}>
          <Link href="/login" className="underline decoration-border-strong underline-offset-2">
            Sign in
          </Link>{' '}
          to send private messages. They are sealed and gift-wrapped (NIP-17), so relays can
          see neither who is talking to whom nor what was said.
        </p>
      </div>
    )
  }

  /** Requests are a separate list, never a hidden one. */
  const source = box === 'requests' ? inbox.requests : inbox.inbox
  const shown = source.filter(conversation => {
    if (filter === 'unread' && conversation.unreadCount === 0) return false
    return true
  })

  return (
    <div
      /* Full viewport minus the mobile header, and never taller. */
      /* 5px UNDER THE COMPOSER, ON BOTH BREAKPOINTS. */
      className="flex h-[calc(100dvh-var(--chrome-h,0rem))] min-h-0 pb-[calc(var(--bottom-nav-h)+5px+var(--bottom-nav-inset))] sm:h-dvh sm:pb-[5px]"
    >
      {/* One pane at a time on mobile: the list, until a conversation is open. */}
      <div
        className={`min-h-0 w-full shrink-0 flex-col border-border md:flex md:w-[380px] md:border-r ${
          open === undefined ? 'flex' : 'hidden'
        }`}
      >
        <div className="flex items-center gap-2 px-4 pt-4 sm:px-5">
          <h1 className={`flex-1 ${PAGE_TITLE}`}>Chat</h1>

          {/* Only when there is something to clear. */}
          {inbox.inboxUnread > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              title="Mark all conversations as read"
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-text-muted transition-colors hover:bg-hover hover:text-text"
            >
              <span className="material-symbols-outlined text-[20px]!" aria-hidden="true">
                done_all
              </span>
              <span className="hidden sm:inline">Mark all read</span>
            </button>
          ) : null}

          <div ref={filterBox} className="relative">
            <button
              type="button"
              onClick={() => setFilterOpen(value => !value)}
              aria-expanded={filterOpen}
              /* h-9, down from h-10. At 40px the capsule was taller than the text needed and read. */
              className="flex h-9 cursor-pointer items-center gap-1 rounded-full border border-border-strong px-4 text-sm font-semibold text-text transition-colors hover:bg-hover"
            >
              {filter === 'all' ? 'All' : 'Unread'}
              <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
                expand_more
              </span>
            </button>
            {filterOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-lg"
              >
                {(
                  [
                    ['all', 'All'],
                    ['unread', 'Unread'],
                  ] as [FilterId, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={filter === id}
                    onClick={() => {
                      setFilter(id)
                      setFilterOpen(false)
                    }}
                    className={`flex w-full cursor-pointer px-4 py-2.5 text-left text-sm transition-colors hover:bg-bg-inset ${
                      filter === id ? 'font-semibold text-text' : 'text-text-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* NEW CHAT, to the RIGHT of the filter and last in the row. */}
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-label="New chat"
            title="New chat"
            /** A bordered circle, not a bare glyph. */
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-strong text-text transition-colors hover:bg-hover"
          >
            <NewChatIcon size={20} />
          </button>
        </div>

        {/* Under the header, above everything else in the pane: a delivery list that cannot. */}
        <div className="mt-3">
          <DmRelayNotice self={self} signer={signer} />
        </div>

        {/* Only when there is something to switch. */}
        {inbox.requests.length === 0 ? null : (
          <div className={`mt-3 ${TAB_STRIP}`}>
            <div role="tablist" aria-label="Inbox" className={TAB_STRIP_ROW}>
              {(
                [
                  ['inbox', 'Inbox', inbox.inboxUnread],
                  ['requests', 'Requests', inbox.requestUnread],
                ] as ['inbox' | 'requests', string, number][]
              ).map(([id, label, unread]) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={box === id}
                  onClick={() => setBox(id)}
                  className={TAB_CELL}
                >
                  <span className={TAB_LABEL}>
                    <span className={box === id ? TAB_ACTIVE : TAB_IDLE}>
                      {label}
                    </span>
                    {box === id ? (
                      <span
                        aria-hidden="true"
                        className={TAB_UNDERLINE}
                      />
                    ) : null}
                  </span>
                  {unread > 0 ? (
                    /** A CIRCLE AT EVERY COUNT, and the app's ink rather than the brand purple. */
                    <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-text text-[10px] font-bold leading-none text-bg tabular-nums">
                      {unread > 999 ? '999' : unread}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-4 pb-3 pt-3 sm:px-5">
          <div className="relative">
            <span
              className="material-symbols-outlined pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px]! text-text-faint"
              aria-hidden="true"
            >
              search
            </span>
            <label htmlFor="chat-q" className="sr-only">
              Search conversations
            </label>
            <input
              id="chat-q"
              type="search"
              value={term}
              onChange={event => setTerm(event.target.value)}
              placeholder="Search"
              className="w-full rounded-full border border-transparent bg-bg-inset py-2.5 pl-11 pr-4 text-text placeholder:text-text-faint focus:outline-none"
            />
          </div>
        </div>

        {chat.signerStalled ? (
          <p className="mx-4 mb-3 rounded-lg border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-text sm:mx-5">
            Your signer stopped answering, so messages cannot be opened. Reconnect it and
            reload.
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {chat.loading && chat.conversations.length === 0 ? (
            /* Twelve rows, matching the timeline and News. */
            <ul aria-hidden="true" className="px-4 sm:px-5">
              {['85%', '62%', '78%', '55%', '90%', '68%', '74%', '58%', '83%', '65%', '88%', '70%'].map(
                (width, row) => (
                  <li key={row} className="flex gap-3 py-4">
                    <div className="size-11 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
                    <div className="flex-1 space-y-2 pt-1.5">
                      <div className="h-3 w-32 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
                      <div
                        className="h-3 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none"
                        style={{ width }}
                      />
                    </div>
                  </li>
                ),
              )}
            </ul>
          ) : shown.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-text-muted">
                {filter === 'unread' ? 'Nothing unread.' : 'No conversations yet.'}
              </p>
              {/* Mobile only. */}
              {filter === 'unread' ? null : (
                <button
                  type="button"
                  onClick={() => setComposing(true)}
                  className="mt-4 cursor-pointer rounded-full bg-text px-5 py-2.5 text-sm font-bold text-bg transition-opacity hover:opacity-90 md:hidden"
                >
                  New chat
                </button>
              )}
            </div>
          ) : (
            <ul
              /* NO padding here. */
            >
              {shown.map(conversation => (
                <ConversationRow
                  key={conversation.key}
                  conversation={conversation}
                  preview={chat.previews.get(conversation.key)}
                  self={self}
                  term={term}
                  active={conversation.key === openKey}
                  onSelect={() => select(conversation.key)}
                />
              ))}
            </ul>
          )}

          {chat.pending > 0 ? (
            <p className="px-6 py-4 text-center text-xs text-text-faint">
              Opening {chat.pending.toLocaleString()} more…
            </p>
          ) : null}
        </div>
      </div>

      <div className={`min-h-0 flex-1 ${open === undefined ? 'hidden md:block' : 'block'}`}>
        {open === undefined ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="flex size-[150px] items-center justify-center rounded-full bg-bg-inset text-text">
              <ChatBubbleIcon size={64} weight={1.6} />
            </span>
            <h2 className="mt-8 text-2xl font-bold text-text">Start Conversation</h2>
            <p className="mt-2 max-w-sm text-text-muted">
              Start a conversation, or choose an existing one.
            </p>
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="mt-6 cursor-pointer rounded-full bg-text px-6 py-3 font-bold text-bg transition-opacity hover:opacity-90"
            >
              New chat
            </button>
          </div>
        ) : (
          <ChatConversation
            conversation={open}
            messages={chat.messagesByConversation.get(open.key) ?? []}
            self={self}
            signer={signer}
            onBack={() => select(undefined)}
            // Asked of the CURRENT split rather than the tab, so a conversation accepted.
            isRequest={inbox.requests.some(item => item.key === open.key)}
            // Accepting moves it to the inbox and deleting removes it, so either way the pane.
            onDecided={() => select(undefined)}
          />
        )}
      </div>

      {composing ? (
        <NewChatModal
          self={self}
          onClose={() => setComposing(false)}
          onPick={pubkey => {
            setComposing(false)
            select(conversationKeyOf([self, pubkey]))
          }}
        />
      ) : null}
    </div>
  )
}

/** Width of the red Delete panel, and therefore how far a row slides. */
const SWIPE_WIDTH = 88

/** One conversation, as a row. */
export function ConversationRow({
  conversation,
  preview,
  self,
  term,
  active,
  onSelect,
}: {
  conversation: Conversation
  preview: ConversationPreview | undefined
  self: Hex
  term: string
  active: boolean
  onSelect: () => void
}): React.ReactNode {
  const other = counterpart(conversation, self)
  const profile = useProfile(other)
  const verified = useNip05Verified(profile?.nip05, other ?? '')
  const now = useNowSeconds()

  /** Swipe to delete, on touch only. */
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startOffset = useRef(0)

  const onTouchStart = (event: React.TouchEvent): void => {
    startX.current = event.touches[0]?.clientX ?? 0
    startOffset.current = offset
    setDragging(true)
  }

  const onTouchMove = (event: React.TouchEvent): void => {
    const x = event.touches[0]?.clientX ?? 0
    // Clamped: left only as far as the panel is wide, and never right of home.
    const next = Math.min(0, Math.max(-SWIPE_WIDTH, startOffset.current + (x - startX.current)))
    setOffset(next)
  }

  const onTouchEnd = (): void => {
    setDragging(false)
    // Past halfway commits to open, short of it snaps home.
    setOffset(offset < -SWIPE_WIDTH / 2 ? -SWIPE_WIDTH : 0)
  }

  const name =
    other === undefined
      ? `${conversation.participants.length} people`
      : profileDisplayName(profile ?? { pubkey: other })

  // Searching filters on the name only.
  if (term.trim() !== '' && !name.toLowerCase().includes(term.trim().toLowerCase())) return null

  const remove = (): void => {
    setOffset(0)
    deleteRequest(conversation.key)
  }

  return (
    <li className="relative overflow-hidden border-b border-border last:border-b-0">
      {/* THE RED PANEL, sitting behind the row and revealed by dragging it aside. */}
      <button
        type="button"
        aria-hidden={offset === 0}
        tabIndex={-1}
        onClick={remove}
        style={{ width: SWIPE_WIDTH }}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-danger text-sm font-bold text-on-danger"
      >
        Delete
      </button>

      {/* The row proper, which slides. */}
      <div
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={`relative flex items-stretch transition-colors ${
          dragging ? '' : 'transition-transform duration-200 ease-out'
        } ${active ? 'bg-bg-inset' : 'bg-bg hover:bg-bg-elevated'}`}
      >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 cursor-pointer gap-3 px-4 py-4 text-left sm:px-5"
      >
        {/* The same hover card the timeline and notifications. */}
        <ProfileHoverCard pubkey={(other ?? conversation.key) as Hex}>
          <Avatar pubkey={other ?? conversation.key} name={name} picture={profile?.picture} size="lg" />
        </ProfileHoverCard>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="min-w-0 truncate font-bold text-text">{name}</span>
            {verified ? (
              <VerifiedBadge size={16} />
            ) : null}
            <span className="ml-auto shrink-0 text-sm text-text-muted">
              {now === 0 ? null : relativeTime(conversation.lastMessageAt, now)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span
              className={`min-w-0 flex-1 truncate text-[15px] ${
                conversation.unreadCount > 0 ? 'font-semibold text-text' : 'text-text-muted'
              }`}
            >
              {preview === undefined ? '' : preview.fromSelf ? `You: ${preview.text}` : preview.text}
            </span>
            {/* The same orange as the nav dots and the "Show N notes" pill. */}
            {conversation.unreadCount > 0 ? (
              <span className="size-2.5 shrink-0 rounded-full bg-[#f97315]" aria-label="Unread" />
            ) : null}
          </span>
        </span>
      </button>

        {/* NO ⋯ here. */}
      </div>
    </li>
  )
}

