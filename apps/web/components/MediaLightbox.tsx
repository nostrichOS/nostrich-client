'use client'

import { Link } from './AppLink'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, ThemeProvider, useTheme, VerifiedBadge, type IconName } from '@nostrich/app'
import {
  buildComment,
  buildReply,
  isComment,
  parseContent,
  profileDisplayName,
  profileHandle,
  shortNpub,
  type NostrEvent,
} from '@nostrich/nostr'

import { compactCount, npubOf, relativeTime } from '../lib/format'
import { useInteractions } from '../lib/interactions'
import { noteHref, profileHref } from '../lib/links'
import { useNoteActions } from './useNoteActions'
import { useMentionField } from '../lib/mentions'
import { getPool } from '../lib/pool'
import { announcePublished } from '../lib/published'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { useThread } from '../lib/thread'
import { openModal } from '../lib/modal'
import { ContentLink } from './ContentLink'
import { Avatar } from './Avatar'
import { useNowSeconds } from './Clock'
import { FollowButton } from './FollowButton'
import { NoteCard } from './NoteCard'
import { MentionPicker } from './MentionPicker'
import { NoteContent } from './NoteContent'
import { QuotedNote, quotePointer } from './QuotedNote'
import { ReplyComposer } from './ReplyComposer'
import { sessionPubkey, useSession } from './SessionProvider'

const MAX_REPLY = 4_000
/** Textarea ceiling in the viewer's reply pill, past which it scrolls instead. */
const REPLY_MAX_HEIGHT = 96

/** Round chrome button. */
const CHROME_BUTTON =
  'flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20'

/** Full-screen media viewer. */
export function MediaLightbox({
  event,
  src,
  onClose,
}: {
  event: NostrEvent
  src: string
  onClose: () => void
}): React.ReactNode {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const replyRef = useRef<HTMLTextAreaElement>(null)

  // No `useRouter` here any more.
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const signer = session.status === 'signed' ? session.signer : undefined

  const thread = useThread(event.id)
  const profile = useProfile(event.pubkey)
  const verified = useNip05Verified(profile?.nip05, event.pubkey)
  const now = useNowSeconds()
  /** THE SAME ACTIONS THE FEED CARD HAS, from the same hook. */
  const actions = useNoteActions(event)

  const segments = useMemo(() => parseContent(event.content, event.tags), [event.content, event.tags])
  // Every image in the note, in the order it appears.
  const media = useMemo(() => {
    const urls = segments.flatMap(segment => (segment.type === 'image' ? [segment.url] : []))
    return urls.includes(src) ? urls : [src]
  }, [segments, src])
  /** A quote in the caption renders as a card, like it does everywhere else. */
  const quoted = useMemo(() => quotePointer(event), [event])

  // A note that is nothing but its image URL has no caption once the media is stripped.
  const hasCaption =
    quoted !== undefined ||
    segments.some(
      segment =>
        segment.type !== 'image' && segment.type !== 'video' && segment.type !== 'event' &&
        (segment.type !== 'text' || segment.value.trim() !== ''),
    )

  const start = useMemo(() => Math.max(0, media.indexOf(src)), [media, src])
  const [index, setIndex] = useState(start)

  const replyIds = useMemo(() => {
    const ids: string[] = [event.id]
    const walk = (nodes: typeof thread.replies): void => {
      for (const node of nodes) {
        ids.push(node.event.id)
        walk(node.children)
      }
    }
    walk(thread.replies)
    return ids
  }, [event.id, thread.replies])
  const { counts } = useInteractions(replyIds)
  const count = counts.get(event.id)

  useEffect(() => {
    const node = dialogRef.current
    if (node === null) return
    openModal(node)
    // Same task as showModal, so the browser paints the tapped image rather than painting.
    const track = trackRef.current
    if (track !== null) track.scrollLeft = track.clientWidth * start
    return () => {
      if (node.open) node.close()
    }
  }, [start])

  /** Scrolling the track IS the state. */
  const show = useCallback(
    (next: number): void => {
      const track = trackRef.current
      if (track === null) return
      const clamped = Math.min(Math.max(next, 0), media.length - 1)
      track.scrollTo({ left: clamped * track.clientWidth, behavior: 'smooth' })
    },
    [media.length],
  )

  // `requireSigner` comes from the hook now, so the viewer and the feed card cannot.
  const { requireSigner } = actions

  const name = profileDisplayName({ ...profile, pubkey: event.pubkey })
  const npub = npubOf(event.pubkey)
  /* The same @handle every other surface shows. */
  const chosen = profileHandle(profile)
  const handle = chosen === undefined ? shortNpub(event.pubkey) : `@${chosen}`

  return (
    <>
    <dialog
      /* Focusable so `openModal` can put the initial focus HERE rather than letting. */
      tabIndex={-1}
      ref={dialogRef}
      // `cancel`, NOT `close`: cancel is the user dismissing with Escape, while close also.
      onCancel={event => {
        /** Only the DIALOG's own cancel closes the viewer. */
        if (event.target !== event.currentTarget) return
        onClose()
      }}
      onKeyDown={e => {
        /* NOT while somebody is typing. */
        const target = e.target as HTMLElement | null
        if (target !== null && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
        if (media.length < 2) return
        if (e.key === 'ArrowRight') show(index + 1)
        if (e.key === 'ArrowLeft') show(index - 1)
      }}
      aria-label="Media"
      // The dialog IS the viewport here rather than a centred card.
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-black p-0 backdrop:bg-black"
    >
      <div className="flex h-full flex-col md:flex-row">
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* A real bar, not a button floating over the photo: the reference reserves. */}
          <div className="flex shrink-0 items-center justify-between px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
            {/* Close, not a back arrow, on every size: the viewer is a layer over the feed rather. */}
            <button type="button" onClick={onClose} aria-label="Close" className={CHROME_BUTTON}>
              <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
                close
              </span>
            </button>

            <MoreMenu event={event} imageUrl={media[index] ?? src} />
          </div>

          <div
            ref={trackRef}
            onScroll={() => {
              const track = trackRef.current
              if (track === null || track.clientWidth === 0) return
              const next = Math.round(track.scrollLeft / track.clientWidth)
              setIndex(current => (current === next ? current : next))
            }}
            // Scroll-snap rather than a transform carousel: the swipe, its rubber-banding.
            className="no-scrollbar flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
          >
            {media.map(url => (
              <div
                key={url}
                // Clicking the space around the image closes.
                onClick={e => {
                  if (e.target === e.currentTarget) onClose()
                }}
                className="flex w-full shrink-0 snap-center items-center justify-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host. */}
                <img
                  src={url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ))}
          </div>

          {/* Desktop has no swipe, so it gets the arrows. */}
          {media.length > 1 ? (
            <>
              {index > 0 ? (
                <button
                  type="button"
                  onClick={() => show(index - 1)}
                  aria-label="Previous image"
                  className={`absolute left-4 top-1/2 hidden -translate-y-1/2 md:flex ${CHROME_BUTTON}`}
                >
                  <span className="material-symbols-outlined text-[24px]!" aria-hidden="true">
                    chevron_left
                  </span>
                </button>
              ) : null}
              {index < media.length - 1 ? (
                <button
                  type="button"
                  onClick={() => show(index + 1)}
                  aria-label="Next image"
                  className={`absolute right-4 top-1/2 hidden -translate-y-1/2 md:flex ${CHROME_BUTTON}`}
                >
                  <span className="material-symbols-outlined text-[24px]!" aria-hidden="true">
                    chevron_right
                  </span>
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        {/* PHONE BAND. */}
        <ThemeProvider>
          <div className="dark shrink-0 bg-black md:hidden">
            {media.length > 1 ? (
              // The dots are a position readout, not the primary control.
              <div className="flex items-center justify-center gap-1.5 py-3">
                {media.map((url, dot) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => show(dot)}
                    aria-label={`Show image ${dot + 1} of ${media.length}`}
                    aria-current={dot === index}
                    className={`size-1.5 rounded-full transition-colors ${dot === index ? 'bg-white' : 'bg-white/35'}`}
                  />
                ))}
              </div>
            ) : null}

            <div className={`flex items-center gap-3 px-4 ${media.length > 1 ? '' : 'pt-4'}`}>
              <Link href={profileHref(npub)} aria-label={`Profile of ${name}`}>
                <Avatar pubkey={event.pubkey} name={name} picture={profile?.picture} />
              </Link>

              <div className="min-w-0 flex-1">
                <Link href={profileHref(npub)} className="flex items-center gap-1">
                  <span className="truncate text-[15px] font-bold text-white">{name}</span>
                  {verified ? <VerifiedBadge /> : null}
                </Link>
                <span className="block truncate text-[14px] text-white/60">
                  {handle}
                  {now === 0 ? null : <> · {relativeTime(event.created_at, now)}</>}
                </span>
              </div>

              {/* Not shown on your own note. */}
              {viewer !== event.pubkey ? <FollowButton target={event.pubkey} tone="chrome" /> : null}
            </div>

            {hasCaption ? (
              /* TALLER ON A PHONE, unchanged on a desktop. */
              <div className="max-h-[40vh] overflow-y-auto px-4 pt-3 text-white sm:max-h-48">
                <NoteContent
                  event={event}
                  hideMedia
                  hideEventIds={quoted === undefined ? undefined : [quoted.id]}
                />
                {quoted === undefined ? null : <QuotedNote pointer={quoted} />}
              </div>
            ) : null}

            {/* The feed's five actions, in the feed's order and drawn with the feed's own icons. */}
            <div className="no-scrollbar flex items-center justify-between gap-2 overflow-x-auto px-4 pt-4">
              <Chip
                icon="reply"
                label="Reply"
                count={count?.replies}
                onClick={() => {
                  if (requireSigner()) replyRef.current?.focus()
                }}
              />
              {/* The menu opens where the pill is, which is what the feed card uses a captured. */}
              <Chip
                icon="repost"
                label={actions.reposted ? 'Reposted' : 'Repost'}
                count={count?.reposts}
                tone="success"
                active={actions.reposted}
                onClick={pressed =>
                  actions.onRepost({ x: pressed.clientX, y: pressed.clientY })
                }
              />
              <Chip
                icon="zap"
                label="Zap"
                count={count?.zapSats}
                tone="zap"
                active={actions.zapped}
                onClick={() => void actions.onZapTap()}
              />
              <Chip
                icon="like"
                label={actions.liked ? 'Liked' : 'Like'}
                count={count?.likes}
                tone="danger"
                active={actions.liked}
                onClick={actions.onLike}
              />
              <Chip
                icon="bookmark"
                label={actions.bookmarked ? 'Bookmarked' : 'Bookmark'}
                active={actions.bookmarked}
                onClick={actions.onBookmark}
              />
            </div>

            <ViewerReply parent={event} inputRef={replyRef} />
          </div>
        </ThemeProvider>

        {/* The conversation panel is DESKTOP ONLY. */}
        <aside className="hidden min-h-0 w-full flex-col overflow-y-auto border-l border-border bg-bg md:flex md:w-[380px] lg:w-[420px]">
          {/* The note itself, with its own interaction row directly beneath the media. */}
          <NoteCard event={event} counts={count} />

          <ReplyComposer parent={event} />

          {thread.loading ? (
            <p className="px-4 py-6 text-center text-sm text-text-muted" role="status">
              Loading replies…
            </p>
          ) : thread.replies.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-faint">No replies yet.</p>
          ) : (
            thread.replies.map(node => (
              <NoteCard key={node.event.id} event={node.event} counts={counts.get(node.event.id)} />
            ))
          )}
        </aside>
      </div>
    </dialog>

    {/* SIBLINGS of the viewer, not children. */}
    {actions.overlays}
    </>
  )
}

/** One action pill. */
function Chip({
  icon,
  label,
  count,
  tone,
  active = false,
  onClick,
}: {
  icon: IconName
  label: string
  count?: number
  tone?: 'success' | 'danger' | 'zap'
  active?: boolean
  /** Handed the event, so a caller that needs to anchor a menu has the press coordinates. */
  onClick: (pressed: React.MouseEvent<HTMLButtonElement>) => void
}): React.ReactNode {
  const theme = useTheme()
  const shown = count !== undefined && count > 0
  const tint =
    tone === 'success' ? theme.successText : tone === 'danger' ? theme.dangerText : theme.zapText
  // White until the action has been taken, then its own colour.
  const color = active ? tint : '#ffffff'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={shown ? `${label}, ${count}` : label}
      style={{ color }}
      className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white/10 transition-colors hover:bg-white/20 ${
        shown ? 'px-4' : 'w-10 justify-center'
      }`}
    >
      <ActionIcon name={icon} color={color} filled={active} size={20} />
      {shown ? <span className="text-[15px]">{compactCount(count)}</span> : null}
    </button>
  )
}

/** The overflow menu. */
function MoreMenu({ event, imageUrl }: { event: NostrEvent; imageUrl: string }): React.ReactNode {
  const [open, setOpen] = useState(false)

  const copy = (value: string): void => {
    void navigator.clipboard.writeText(value).catch(() => undefined)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        className={CHROME_BUTTON}
      >
        <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
          more_horiz
        </span>
      </button>

      {open ? (
        <>
          {/* Click-away. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            className="absolute right-0 top-12 z-20 w-56 overflow-hidden rounded-xl bg-neutral-900 py-1 text-left text-sm text-white shadow-lg ring-1 ring-white/15"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => copy(new URL(noteHref(event), window.location.origin).toString())}
              className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-white/10"
            >
              Copy link to note
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => copy(imageUrl)}
              className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-white/10"
            >
              Copy image address
            </button>
            <ContentLink
              role="menuitem"
              href={imageUrl}
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 transition-colors hover:bg-white/10"
            >
              Open image in new tab
            </ContentLink>
          </div>
        </>
      ) : null}
    </div>
  )
}

/** The reply field at the bottom of the phone band. */
function ViewerReply({
  parent,
  inputRef,
}: {
  parent: NostrEvent
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}): React.ReactNode {
  const router = useRouter()
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const signer = session.status === 'signed' ? session.signer : undefined

  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mentions = useMentionField()

  const signedIn = viewer !== undefined && signer !== undefined
  const trimmed = text.trim()
  const canSend = signedIn && trimmed !== '' && trimmed.length <= MAX_REPLY && !busy

  const send = async (): Promise<void> => {
    if (!signedIn) {
      router.push('/login')
      return
    }
    if (!canSend || signer === undefined) return
    setBusy(true)
    setError(null)
    try {
      // Names back to pointers before signing.
      const written = mentions.resolve(trimmed)
      const template = isComment(parent)
        ? buildComment(written, parent, { authorPubkey: viewer })
        : buildReply(written, parent)
      const signed = await signer.signEvent(template)
      const results = await getPool().publish(signed)
      if (!results.some(r => r.ok)) {
        // Unlike a like, a reply is written text.
        setError('No relay accepted that reply.')
        return
      }
      // Heard by the thread panel beside the photo, and by the thread behind the viewer.
      announcePublished(signed)
      setText('')
      mentions.clear()
      const node = inputRef.current
      if (node !== null) node.style.height = 'auto'
    } catch (cause) {
      /* The signer's own words, when it has any. */
      setError(cause instanceof Error ? cause.message : 'Signing was cancelled.')
    } finally {
      setBusy(false)
    }
  }

  return (
    // The bottom gap is deliberate breathing room, not just the notch inset: a reply.
    <div className="px-4 pb-[max(env(safe-area-inset-bottom),1.75rem)] pt-4">
      <div className="relative flex items-end gap-2 rounded-[26px] bg-white/10 px-4 py-2.5">
        {/* Opens UPWARD: this field sits at the bottom of the viewer, and a list dropped below. */}
        {mentions.query !== undefined ? (
          <MentionPicker
            query={mentions.query}
            viewer={viewer}
            placement="up"
            onPick={(chosen, name) =>
              mentions.apply(inputRef.current, inputRef.current?.value ?? text, chosen, name, setText)
            }
            onDismiss={mentions.dismiss}
            onActive={mentions.announce}
          />
        ) : null}
        <label htmlFor="viewer-reply" className="sr-only">
          {signedIn ? 'Post your reply' : 'Sign in to reply'}
        </label>
        <textarea
          id="viewer-reply"
          {...mentions.fieldProps}
          ref={inputRef}
          rows={1}
          value={text}
          readOnly={!signedIn}
          maxLength={MAX_REPLY}
          placeholder={signedIn ? 'Post your reply' : 'Sign in to reply'}
          onFocus={() => {
            if (!signedIn) router.push('/login')
          }}
          onChange={e => {
            setText(e.target.value)
            mentions.sync(e.target)
            // Grow with the text up to a ceiling, then scroll.
            e.target.style.height = 'auto'
            e.target.style.height = `${Math.min(e.target.scrollHeight, REPLY_MAX_HEIGHT)}px`
          }}
          // The caret moves for reasons `onChange` never sees.
          onKeyUp={e => mentions.sync(e.currentTarget)}
          onClick={e => mentions.sync(e.currentTarget)}
          onKeyDown={e => {
            // Ctrl/Cmd+Enter sends.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send()
            if (e.key === 'Escape' && mentions.query !== undefined) {
              /* `preventDefault` as well as `stopPropagation`, and the first one is what matters. */
              e.preventDefault()
              e.stopPropagation()
              mentions.dismiss()
            }
          }}
          /* `py-1` MAKES THE FIELD THE BUTTON'S HEIGHT, and that is what centres the text. */
          className="max-h-24 flex-1 resize-none bg-transparent py-1 text-[16px] leading-6 text-white placeholder:text-white/50 focus:outline-none"
        />
        {/* ALWAYS RENDERED, inactive until there is something to send. */}
        <button
          type="button"
          onClick={() => void send()}
          disabled={!canSend}
          aria-busy={busy}
          className="shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error !== null ? (
        <p role="alert" className="px-2 pt-2 text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  )
}
