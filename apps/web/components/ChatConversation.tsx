'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from './AppLink'
import {
  type ContentSegment,
  parseContent,
  isFileMessage,
  profileDisplayName,
  type Conversation,
  type DecryptedDirectMessage,
  type Hex,
  type Signer,
} from '@nostrich/nostr'

import { useDismiss } from '../lib/dismiss'
import { acceptRequest, deleteRequest } from '../lib/chat-requests'
import { counterpart, markConversationRead, sendChatMessage } from '../lib/chat'
import { absoluteDate, npubOf, relativeTime } from '../lib/format'
import { profileHref } from '../lib/links'
import { useUploads } from '../lib/upload'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { asset } from '../lib/assets'
import { Avatar } from './Avatar'
import { VerifiedBadge } from './VerifiedBadge'
import { useNowSeconds } from './Clock'
import { DraftMedia } from './DraftMedia'
import { splitMessage } from '../lib/media-text'
import { useAutoGrow } from '../lib/autogrow'

/** One conversation: header, transcript, composer. */

/** Longer than this between messages and the transcript shows the date again. */
const DATE_BREAK_SECONDS = 6 * 3_600

export function ChatConversation({
  conversation,
  messages,
  self,
  signer,
  onBack,
  isRequest = false,
  onDecided,
}: {
  conversation: Conversation
  messages: DecryptedDirectMessage[]
  self: Hex
  signer: Signer
  onBack: () => void
  /** Shows the accept/delete bar in place of the composer. */
  isRequest?: boolean
  onDecided?: () => void
}): React.ReactNode {
  const other = counterpart(conversation, self)
  const profile = useProfile(other)
  const verified = useNip05Verified(profile?.nip05, other ?? '')
  const now = useNowSeconds()

  const [draft, setDraft] = useState('')
  const photoRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  /** Photos go to Blossom and the MESSAGE carries the URL. */
  /* EXEMPT from the posting gate. */
  const uploads = useUploads({ gate: 'exempt' })
  const sentUploads = useRef(new Set<string>())
  /** Pictures attached to the message being written. */
  const [media, setMedia] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Grows with the message.
  useAutoGrow(textareaRef, draft, 0.25, 44)

  const name =
    other === undefined
      ? `${conversation.participants.length} people`
      : profileDisplayName(profile ?? { pubkey: other })

  // Opening a conversation IS reading it, and the marker is the newest message rather.
  const newest = messages[messages.length - 1]?.createdAt
  useEffect(() => {
    if (newest !== undefined) markConversationRead(conversation.key, newest)
  }, [conversation.key, newest])

  // Jump to the bottom on open and on every new message: a transcript opened.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [conversation.key, messages.length])

  const rows = useMemo(() => {
    const out: { message: DecryptedDirectMessage; showDate: boolean }[] = []
    let previous = 0
    for (const message of messages) {
      out.push({ message, showDate: message.createdAt - previous > DATE_BREAK_SECONDS })
      previous = message.createdAt
    }
    return out
  }, [messages])

  /** Inserted at the caret rather than appended, so a pick mid-sentence lands. */
  /** A finished upload joins the ATTACHED MEDIA, not the draft text. */
  useEffect(() => {
    for (const url of uploads.urls) {
      if (sentUploads.current.has(url)) continue
      sentUploads.current.add(url)
      setMedia(current => (current.includes(url) ? current : [...current, url]))
    }
  }, [uploads.urls])

  const send = async (): Promise<void> => {
    // The words, then each attachment on its own line.
    const content = [draft.trim(), ...media].filter(part => part !== '').join('\n\n')
    if (content === '' || sending) return
    setSending(true)
    setError(undefined)
    try {
      const recipients = conversation.participants.filter(pubkey => pubkey !== self)
      const result = await sendChatMessage(signer, recipients, content)
      if (!result.ok) {
        setError('No relay accepted that message.')
        return
      }
      /* A refusal by every relay somebody nominated is a failure to deliver, not a warning. */
      if (result.unreachable.length > 0) {
        const many = result.unreachable.length > 1
        setError(
          many
            ? `${result.unreachable.length} recipients' message relays refused this. They will not receive it.`
            : 'Their message relays refused this, so it was not delivered.',
        )
      }
      if (result.undeliverable.length > 0) {
        // Not a failure of ours to hide.
        setError(
          `Sent, but ${result.undeliverable.length} participant${
            result.undeliverable.length === 1 ? ' has' : 's have'
          } no message relay list and will not receive it.`,
        )
      }
      setDraft('')
      setMedia([])
      uploads.clear()
    } catch (cause) {
      // The signer's own words when it has any: "refused or unreachable" is right.
      setError(
        cause instanceof Error
          ? cause.message
          : 'That could not be sent. Your signer refused or is unreachable.',
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="-ml-2 flex size-9 cursor-pointer items-center justify-center rounded-full text-text transition-colors hover:bg-bg-inset md:hidden"
        >
          <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
            arrow_back
          </span>
        </button>

        {other === undefined ? (
          <Avatar pubkey={conversation.key} name={name} size="md" />
        ) : (
          <Link href={profileHref(npubOf(other))} className="shrink-0">
            <Avatar pubkey={other} name={name} picture={profile?.picture} size="md" />
          </Link>
        )}

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="min-w-0 truncate font-bold text-text">{name}</span>
            {verified ? (
              <VerifiedBadge size={16} />
            ) : null}
          </p>
          {/* Said on the conversation itself, not in a settings page nobody opens. */}
          <p className="truncate text-xs text-text-faint">Encrypted end to end</p>
        </div>

        {/* The ⋯, in the space to the right of the name that was empty anyway. */}
        <ConversationMenu
          name={name}
          {...(other === undefined ? {} : { profileHref: profileHref(npubOf(other)) })}
          onDelete={() => {
            deleteRequest(conversation.key)
            /* And LEAVE, which the menu forgot to do. */
            onDecided?.()
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-text-muted">
            No messages yet. Say something.
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map(({ message, showDate }) => (
              <li key={message.id}>
                {showDate ? (
                  <p className="py-3 text-center text-xs text-text-faint">
                    {absoluteDate(message.createdAt)}
                  </p>
                ) : null}
                <Bubble message={message} mine={message.senderPubkey === self} now={now} />
              </li>
            ))}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      {isRequest ? (
        /** The decision bar, in place of the composer. */
        <div className="border-t border-border px-4 py-4">
          <p className="text-center text-sm text-text-muted">
            Accept message requests from{' '}
            <span className="font-bold text-text">{name}</span>
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                deleteRequest(conversation.key)
                onDecided?.()
              }}
              className="flex-1 cursor-pointer rounded-full bg-bg-inset px-5 py-2.5 text-sm font-bold text-text transition-colors hover:bg-border"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => {
                acceptRequest(conversation.key)
                onDecided?.()
              }}
              className="flex-1 cursor-pointer rounded-full bg-text px-5 py-2.5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
            >
              Accept
            </button>
          </div>
          {/* Said plainly: "Delete" cannot mean what it means elsewhere, because the messages. */}
          <p className="mt-3 text-center text-xs text-text-faint">
            Deleting removes this conversation from your device.
          </p>
        </div>
      ) : (
      <>
      {/* Straight to Blossom, never through our server. */}
      <input
        ref={photoRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={event => {
          if (event.target.files !== null) uploads.add(event.target.files, signer)
          event.target.value = ''
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={event => {
          if (event.target.files !== null) uploads.add(event.target.files, signer)
          event.target.value = ''
        }}
      />

      <div className="border-t border-border px-4 py-3">
        {error !== undefined ? <p className="mb-2 text-xs text-danger-text">{error}</p> : null}
        {/* The attachments, drawn. */}
        <div className="pb-2">
          <DraftMedia
            urls={media}
            onRemove={url => setMedia(current => current.filter(item => item !== url))}
          />
        </div>

        <form
          className="flex items-end gap-1.5"
          onSubmit={event => {
            event.preventDefault()
            void send()
          }}
        >
          {/* THE ATTACH BUTTON, at the far left of the row. */}
          <AttachMenu
            onPhotos={() => photoRef.current?.click()}
            onCamera={() => cameraRef.current?.click()}
          />

          {/* THE FIELD AND SEND, as one control. */}
          <div className="relative min-w-0 flex-1">
          <label htmlFor="chat-draft" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-draft"
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              // Enter sends, Shift+Enter breaks the line.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder="Start a new chat"
            /* NO focus border. */
            /* `rounded-3xl`, NOT `rounded-full`, and the difference only shows on a long message. */
            /* `block` is not cosmetic. */
            /* `overflow-y-auto no-scrollbar`: the field grows to `useAutoGrow`'s ceiling. */
            className="no-scrollbar block min-h-11 w-full resize-none overflow-y-auto rounded-3xl border border-transparent bg-bg-inset py-3 pl-4 pr-14 text-text placeholder:text-text-faint focus:outline-none"
          />

          <button
            type="submit"
            /* A picture on its own is a message. */
            disabled={(draft.trim() === '' && media.length === 0) || sending || uploads.busy}
            aria-label="Send"
            /* Pinned to the field's right edge. */
            className="absolute bottom-1.5 right-1 flex size-9 cursor-pointer items-center justify-center rounded-full bg-text text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {/* An arrow UP, not a paper plane. */}
            <span className="material-symbols-outlined text-[20px]!" aria-hidden="true">
              arrow_upward
            </span>
          </button>
          </div>
        </form>
      </div>
      </>
      )}
    </div>
  )
}

function Bubble({
  message,
  mine,
  now,
}: {
  message: DecryptedDirectMessage
  mine: boolean
  now: number
}): React.ReactNode {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
            mine ? 'bg-text text-bg' : 'bg-bg-inset text-text'
          }`}
        >
          {isFileMessage(message) ? (
            // The content of a kind-15 is a URL to a blob encrypted with a key carried in its tags.
            <span className="italic opacity-80">Encrypted attachment, not supported yet</span>
          ) : (
            <BubbleContent content={message.content} />
          )}
        </div>
        <span className="mt-0.5 px-1 text-[11px] text-text-faint">
          {now === 0 ? absoluteDate(message.createdAt) : relativeTime(message.createdAt, now)}
        </span>
      </div>
    </div>
  )
}

/** The conversation's ⋯ menu. */
function ConversationMenu({
  name,
  profileHref: href,
  onDelete,
}: {
  name: string
  /** Absent for a GROUP conversation, where there is no single person to visit. */
  profileHref?: string
  onDelete: () => void
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useDismiss(open, ref, useCallback(() => setOpen(false), []))

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Options for ${name}`}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="-mr-2 flex size-9 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
      >
        <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
          more_horiz
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-bg-elevated py-1 shadow-lg"
        >
          {/* Visit profile first: it is the one people reach for, and putting a destructive item. */}
          {href === undefined ? null : (
            <Link
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-text transition-colors hover:bg-bg-inset"
            >
              {/* Outlined, 18px, matching every other glyph in a menu here. */}
              <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
                person
              </span>
              Visit profile
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-danger-text transition-colors hover:bg-bg-inset"
          >
            <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
              delete
            </span>
            Delete chat
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** The + that opens the attach options. */
/** Whether the primary input is a finger. */
function touchPrimary(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: none), (pointer: coarse)').matches
}

function AttachMenu({
  onPhotos,
  onCamera,
}: {
  onPhotos: () => void
  onCamera: () => void
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useDismiss(open, ref, useCallback(() => setOpen(false), []))

  /** Camera is offered only on a device that has one to point at something. */
  const items: { icon: string; label: string; run: () => void }[] = [
    { icon: 'image', label: 'Photos', run: onPhotos },
    ...(touchPrimary() ? [{ icon: 'photo_camera', label: 'Camera', run: onCamera }] : []),
  ]

  return (
    <div ref={ref} className="relative shrink-0 self-end">
      <button
        type="button"
        aria-label="Add to message"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-bg-inset text-text-muted transition-colors hover:bg-border hover:text-text"
      >
        {/* Rotates into a ✕ when open, so the same control that opened the menu visibly closes. */}
        <span
          className={`material-symbols-outlined text-[24px]! transition-transform duration-200 ${
            open ? 'rotate-45' : ''
          }`}
          aria-hidden="true"
        >
          add
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          /* 13px of clearance, not 8. The menu opens upward off a button that sits. */
          className="absolute bottom-full left-0 z-50 mb-[13px] w-44 overflow-hidden rounded-xl border border-border bg-bg-elevated py-1 shadow-lg"
        >
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                item.run()
              }}
              className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm font-semibold text-text transition-colors hover:bg-bg-inset"
            >
              <span className="material-symbols-outlined text-[20px]! text-text-muted" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** A message body, with pictures drawn as pictures. */
function BubbleContent({ content }: { content: string }): React.ReactNode {
  // Words and pictures, split without rewriting either.
  const { text, media } = useMemo(() => splitMessage(content), [content])

  return (
    <>
      {text === '' ? null : <span>{text}</span>}
      {media.map((segment, index) => (
        <span key={index} className={`block ${text === '' && index === 0 ? '' : 'mt-2'}`}>
          {segment.type === 'image' ? (
            /* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host */
            <img
              src={segment.url}
              alt=""
              loading="lazy"
              decoding="async"
              // Someone else's CDN.
              referrerPolicy="no-referrer"
              // Sized to the picture and capped, the same rule the composer preview follows.
              className="h-auto max-h-72 w-auto max-w-full rounded-xl"
            />
          ) : (
            <video
              src={segment.url}
              controls
              playsInline
              preload="metadata"
              className="h-auto max-h-72 w-auto max-w-full rounded-xl"
            />
          )}
        </span>
      ))}
    </>
  )
}
