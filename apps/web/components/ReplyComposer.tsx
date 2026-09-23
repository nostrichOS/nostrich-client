'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildComment,
  buildReply,
  isComment,
  profileDisplayName,
  type NostrEvent,
} from '@nostrich/nostr'

import { useUploads } from '../lib/upload'

import { getPool } from '../lib/pool'
import { announcePublished, announceRetracted } from '../lib/published'
import { useProfile } from '../lib/profiles'
import { useMentionField } from '../lib/mentions'
import { Avatar } from './Avatar'
import { EmojiPicker } from './EmojiPicker'
import { DraftMedia } from './DraftMedia'
import { AttachmentPreview } from './AttachmentPreview'
import { REPLY_PREVIEW_MAX_HEIGHT } from '../lib/preview-fit'
import { DraftMediaRail } from './DraftMediaRail'
import { MediaGateNotice } from './MediaGateNotice'
import { LinkPreview, useUnfurl } from './LinkPreview'
import { DraftQuoteCard } from './DraftQuoteCard'
import { DraftMediaUrls } from './DraftMediaUrls'
import { useAttachedMedia } from '../lib/draft-media'
import { PreviewDismiss } from './PreviewDismiss'
import { useAttachedQuote } from '../lib/attached-quote'
import { useDraftLink } from '../lib/draft-link'
import { useAttachedLink, useCaptureWhenReady } from '../lib/attached-link'
import { MentionPicker } from './MentionPicker'
import { sessionPubkey, useSession } from './SessionProvider'
import { useAutoGrow } from '../lib/autogrow'
import { DRAFT_TYPOGRAPHY, DraftHighlight } from './DraftHighlight'

const MAX = 4_000

/** The reply box under a note. */
export function ReplyComposer({ parent }: { parent: NostrEvent }): React.ReactNode {
  const router = useRouter()
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const signer = session.status === 'signed' ? session.signer : undefined
  /** The same three controls the main composer. */
  const uploads = useUploads()
  /** Never published. */
  const fileRef = useRef<HTMLInputElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const profile = useProfile(viewer)

  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** The highlight layer, kept in step with the field it sits behind. */
  const mirrorRef = useRef<HTMLDivElement>(null)
  const syncMirror = useCallback((field: HTMLTextAreaElement): void => {
    const mirror = mirrorRef.current
    if (mirror === null) return
    mirror.style.transform = `translateY(${-field.scrollTop}px)`
    const gutter = field.offsetWidth - field.clientWidth
    mirror.style.paddingRight = gutter > 0 ? `${gutter}px` : ''
  }, [])
  // Grows with the reply rather than scrolling inside two lines.
  useAutoGrow(textareaRef, text)

  /* The gutter appears and disappears as the draft crosses the scroll ceiling. */
  useEffect(() => {
    const field = textareaRef.current
    if (field !== null) syncMirror(field)
  }, [text, syncMirror])
  // Same mention behaviour as the main composer: a reply is a post, and a reader.
  const mentions = useMentionField()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signedIn = viewer !== undefined && signer !== undefined
  const trimmed = text.trim()
  // An attached photo with no words is a reply, so uploads count as content.

  /** A pointer pasted into a REPLY, previewed like everything else. */
  const media = useAttachedMedia(text, setText)
  const pasted = useAttachedQuote(text, setText)
  const pastedQuote = pasted.quote
  const pastedKey = pastedQuote === undefined ? '' : `${pastedQuote.type}:${pastedQuote.bech32}`
  const pastedCard = useMemo(
    () => (pastedQuote === undefined ? null : <DraftQuoteCard quote={pastedQuote} />),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the KEY is the identity
    [pastedKey],
  )

  /** Lifted out of the draft once its card is real, and appended again at publish. */
  const attached = useAttachedLink()

  /* The `attached` terms are what make a pasted-only reply postable at all. */
  const canSend =
    signedIn &&
    (trimmed !== '' ||
      uploads.urls.length > 0 ||
      media.attached.length > 0 ||
      attached.url !== undefined ||
      pasted.attached !== undefined) &&
    trimmed.length <= MAX &&
    !busy &&
    !uploads.busy
  const draftUrl = useDraftLink(text, uploads.attachments.length > 0 || media.items.length > 0)
  // Nothing is remembered about a dismissed link.
  const candidate = draftUrl
  const cardIsReal = useUnfurl(candidate)
  useCaptureWhenReady(attached, candidate, cardIsReal, text, setText)
  /* `candidate` already asks `attached.dismissed`, which is the hook's own memory. */
  const draftPreview = attached.url ?? candidate

  const send = async (): Promise<void> => {
    if (!signedIn) {
      router.push('/login')
      return
    }
    if (!canSend || signer === undefined) return
    setBusy(true)
    setError(null)
    try {
      // buildReply owns the NIP-10 tags.
      const written = [
        mentions.resolve(trimmed),
        ...uploads.urls,
        // Pasted media rides with the uploads.
        ...media.attached,
        attached.url ?? '',
        pasted.attached ?? '',
      ]
        .filter(part => part !== '')
        .join('\n\n')
      /* ANSWERING A COMMENT WITH A COMMENT, and everything else with a kind-1. NIP-22. */
      const reply = isComment(parent)
        ? buildComment(written, parent, { authorPubkey: viewer })
        : buildReply(written, parent)
      const signed = await signer.signEvent({
        ...reply,
        tags: [...reply.tags, ...uploads.imetaTags],
      })
      /** THE REPLY APPEARS NOW. */
      const draft = { text }
      announcePublished(signed)
      setText('')
      attached.reset()
      pasted.reset()
      media.reset()
      uploads.clear()
      // See the same call in `Composer`: the tokens belong to the note that just went out.
      mentions.clear()
      mentions.dismiss()

      void getPool()
        .publish(signed)
        .then(results => {
          if (results.some(r => r.ok)) return
          // Nobody took.
          announceRetracted(signed.id)
          setText(draft.text)
          setError('No relay accepted that reply.')
        })
        .catch(() => {
          announceRetracted(signed.id)
          setText(draft.text)
          setError('No relay accepted that reply.')
        })
    } catch (cause) {
      /* The signer's own words, when it has any. */
      setError(cause instanceof Error ? cause.message : 'Signing was cancelled.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-border px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        {signedIn ? (
          <Avatar
            pubkey={viewer}
            name={profileDisplayName({ ...profile, pubkey: viewer })}
            picture={profile?.picture}
          />
        ) : (
          // Generic mark rather than a blank circle: it reads as "an account goes here".
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-bg-inset text-text-faint">
            <span className="material-symbols-outlined text-[26px]!" aria-hidden="true">
              person
            </span>
          </span>
        )}

        {/* `relative` anchors the mention picker to the field rather than the page. */}
        <div className="relative min-w-0 flex-1">
          <label htmlFor="reply-box" className="sr-only">
            {signedIn ? 'Post your reply' : 'Sign in to reply'}
          </label>
          {/* The field and its highlight layer share this box, so `inset-0` on the mirror. */}
          <div className="relative">
          <DraftHighlight value={text} mentions={mentions.tokens} trackRef={mirrorRef} />
          <textarea
            {...mentions.fieldProps}
            id="reply-box"
            ref={textareaRef}
            value={text}
            onChange={e => {
              setText(e.target.value)
              mentions.sync(e.currentTarget)
            }}
            onKeyUp={e => mentions.sync(e.currentTarget)}
            onScroll={e => syncMirror(e.currentTarget)}
            onClick={e => mentions.sync(e.currentTarget)}
            onBlur={() => mentions.dismiss()}
            onFocus={() => {
              if (!signedIn) router.push('/login')
            }}
            onKeyDown={e => {
              // Ctrl/Cmd+Enter sends.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send()
              if (e.key === 'Escape' && mentions.query !== undefined) {
                e.preventDefault()
                mentions.dismiss()
              }
            }}
            readOnly={!signedIn}
            rows={1}
            maxLength={MAX}
            placeholder={signedIn ? 'Post your reply' : 'Sign in to reply'}
            /** The glyphs are transparent. */
            className={`relative resize-none overflow-y-auto bg-transparent text-transparent caret-text placeholder:text-text-faint focus:outline-none ${DRAFT_TYPOGRAPHY}`}
          />
          </div>

          {mentions.query !== undefined ? (
            <MentionPicker
              query={mentions.query}
              viewer={viewer}
              onPick={(pubkey, name) =>
                mentions.apply(textareaRef.current, text, pubkey, name, setText)
              }
              onDismiss={mentions.dismiss}
              onActive={mentions.announce}
            />
          ) : null}
          {/* AN UPLOAD NEEDS DRAWING TOO, and this is where it was missing. */}
          {/* The link's own card, while the reply is still being written. */}
          {/* The quoted card, in the same place the posted reply will put. */}
          {pastedCard === null ? null : (
            <div className="relative">
              {pastedCard}
              {/* Puts the pointer back in the draft rather than deleting. */}
              <PreviewDismiss
                onDismiss={() => pasted.dismiss(text, setText)}
                label="Remove quote preview"
              />
            </div>
          )}
          {/* Media pasted as a URL, previewed like an upload. */}
          <DraftMediaUrls items={media.items} onDismiss={media.dismiss} />
          {draftPreview !== undefined ? (
            <div className="relative">
              <LinkPreview url={draftPreview} />
              <PreviewDismiss
                onDismiss={() => attached.discard(draftPreview, text, setText)}
                label="Remove link preview"
              />
            </div>
          ) : null}

          <MediaGateNotice refusal={uploads.refusal} />

          {uploads.attachments.length > 0 ? (
            <DraftMediaRail>
              {uploads.attachments.map(item => (
                <AttachmentPreview key={item.id} item={item} cap={REPLY_PREVIEW_MAX_HEIGHT}>
                  {item.status !== 'done' ? (
                    <span
                      className={`absolute inset-0 flex items-center justify-center rounded-xl px-1 text-center text-sm font-semibold leading-tight ${
                        item.status === 'failed'
                          ? 'bg-danger-surface/90 text-danger-text'
                          : 'bg-black/55 text-white'
                      }`}
                    >
                      {item.status === 'failed' ? (item.error ?? 'Failed') : 'Uploading…'}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => uploads.remove(item.id)}
                    aria-label={`Remove ${item.file.name}`}
                    className="absolute right-2 top-2 flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/75"
                  >
                    <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
                      close
                    </span>
                  </button>
                </AttachmentPreview>
              ))}
            </DraftMediaRail>
          ) : null}

          {error !== null ? (
            <p role="alert" className="text-xs text-danger-text">
              {error}
            </p>
          ) : null}
          {/* Tools and Post on ONE row UNDER the field, exactly as the main composer lays them. */}
          <div className="mt-1 flex items-center justify-between gap-2">
            {/* Signed out there is nothing to attach. */}
            {!signedIn || signer === undefined ? (
              <span />
            ) : (
            <div className="relative flex items-center gap-0.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={event => {
                  if (event.target.files !== null) uploads.add(event.target.files, signer)
                  // Reset so picking the same file twice in a row still fires a change event.
                  event.target.value = ''
                }}
              />
              <ReplyTool
                icon="image"
                label="Add photo or video"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              />
              <ReplyTool
                icon="mood"
                label="Add emoji"
                onClick={() => setEmojiOpen(open => !open)}
                disabled={busy}
              />
              {emojiOpen ? (
                <EmojiPicker
                  onPick={emoji => {
                    setText(current => current + emoji)
                    textareaRef.current?.focus()
                  }}
                  onClose={() => setEmojiOpen(false)}
                />
              ) : null}
            </div>
            )}

          {/* Always says "Post". */}
          <button
            type="button"
            onClick={() => void send()}
            disabled={signedIn && !canSend}
            aria-busy={busy}
            aria-label={signedIn ? 'Post reply' : 'Sign in to reply'}
            className={
              signedIn
                ? 'mt-1 shrink-0 rounded-lg bg-text px-5 py-2 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'
                : 'mt-1 shrink-0 cursor-pointer rounded-lg bg-bg-inset px-5 py-2 text-sm font-bold text-text-faint transition-colors hover:bg-border'
            }
          >
            {busy ? 'Posting…' : 'Post'}
          </button>
          </div>
        </div>

      </div>
    </div>
  )
}

/** One toolbar button. */
function ReplyTool({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-9 cursor-pointer items-center justify-center rounded-full text-nav-icon transition-colors hover:bg-bg-inset disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}
