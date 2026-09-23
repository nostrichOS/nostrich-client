'use client'

import { Link } from './AppLink'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  buildShortNote,
  encodeNevent,
  profileDisplayName,
  referencesFromContent,
  type NostrEvent,
  type PublishResult,
  type Signer,
  type Hex,
} from '@nostrich/nostr'

import { useAutoGrow } from '../lib/autogrow'
import { DRAFT_TYPOGRAPHY, DraftHighlight } from './DraftHighlight'
import { getCachedEvent } from '../lib/event-cache'
import { npubOf } from '../lib/format'
import { getPool } from '../lib/pool'
import { useProfile } from '../lib/profiles'
import { useUploads } from '../lib/upload'
import { LINK } from '../lib/styles'
import { Avatar } from './Avatar'
import { EmojiPicker } from './EmojiPicker'
import { useMentionField } from '../lib/mentions'
import { MENTION_PANEL_WIDTH, MentionPicker } from './MentionPicker'
import { useCaretAnchor } from '../lib/caret-anchor'
import { AttachmentPreview } from './AttachmentPreview'
import { DraftMedia } from './DraftMedia'
import { LinkPreview, useUnfurl } from './LinkPreview'
import { DraftMediaRail } from './DraftMediaRail'
import { MediaGateNotice } from './MediaGateNotice'
import { useDraftLink } from '../lib/draft-link'
import { useAttachedLink, useCaptureWhenReady } from '../lib/attached-link'
import { QuotedNote } from './QuotedNote'
import { announcePublished } from '../lib/published'
import { DraftQuoteCard } from './DraftQuoteCard'
import { DraftMediaUrls } from './DraftMediaUrls'
import { useAttachedMedia } from '../lib/draft-media'
import { PreviewDismiss } from './PreviewDismiss'
import { useAttachedQuote } from '../lib/attached-quote'
import { useSession } from './SessionProvider'

interface ComposerProps {
  /** Called with the signed event before it reaches a relay, for the optimistic row. */
  onPublished: (event: NostrEvent) => void
  /** Called when every relay refused it, so the optimistic row can be taken back. */
  onRejected: (eventId: string) => void
  /** Text to open with, when resuming a draft. */
  initialContent?: string
  /** `@Name` -> pubkey bindings to open with, so a resumed draft's mentions still resolve. */
  initialMentions?: Record<string, string>
  /** Reports the current bindings, so the host can save them with the draft. */
  onMentionsChange?: (bindings: Record<string, string>) => void
  /** The note being quoted, shown as a card and appended as a pointer at publish time. */
  quoting?: { id: string; pubkey: string }
  /** Files to attach the moment the composer opens, as though they had just been picked. */
  initialFiles?: readonly File[]
  /** Reported on every keystroke so a host can offer to save what is unsent. */
  onContentChange?: (text: string) => void
  /** Draw the bottom rule. */
  bordered?: boolean
  /** Hand the publish action to the host instead of drawing a Post button here. */
  onActions?: (actions: {
    canPost: boolean
    publishing: boolean
    uploading: boolean
    publish: () => void
  }) => void
  /** Hide the built-in Post button on PHONES, where the host is drawing its own. */
  hidePostButton?: boolean
  /** Focus the field on mount, so a full-screen composer opens with the keyboard up. */
  autoFocus?: boolean
  /** Bound the draft's height and scroll it, leaving the toolbar pinned below. */
  scrollBody?: boolean
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong while signing.'
}

/** How long a send will wait to find out where its recipients read. */
const INBOX_LOOKUP_MS = 1_500

export function Composer({
  onPublished,
  onRejected,
  initialContent,
  initialMentions,
  onMentionsChange,
  onContentChange,
  quoting,
  initialFiles,
  bordered = true,
  onActions,
  hidePostButton = false,
  autoFocus = false,
  scrollBody = false,
}: ComposerProps): React.ReactNode {
  const { session, adopt } = useSession()
  const pubkey = session.status === 'anonymous' ? undefined : session.pubkey
  const profile = useProfile(pubkey)
  const [content, setContent] = useState(initialContent ?? '')

  /** Report every change, without making the parent own the text. */
  const setBody = (next: string | ((prev: string) => string)): void => {
    setContent(prev => {
      const value = typeof next === 'function' ? next(prev) : next
      onContentChange?.(value)
      return value
    })
  }
  const [publishing, setPublishing] = useState(false)
  const [results, setResults] = useState<PublishResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const fieldId = useId()
  const uploads = useUploads()
  const [emojiOpen, setEmojiOpen] = useState(false)

  // Only ever non-zero once the draft outgrows the field's ceiling.
  /** The highlight layer, kept in step with the field it sits behind. */
  const mirrorRef = useRef<HTMLDivElement>(null)
  /** The origin the mention panel hangs from, and where the caret is inside the field. */
  const anchorRef = useRef<HTMLDivElement>(null)
  const syncMirror = useCallback((field: HTMLTextAreaElement): void => {
    const mirror = mirrorRef.current
    if (mirror === null) return
    mirror.style.transform = `translateY(${-field.scrollTop}px)`
    const gutter = field.offsetWidth - field.clientWidth
    mirror.style.paddingRight = gutter > 0 ? `${gutter}px` : ''
  }, [])

  // The field extends with the draft instead of scrolling inside itself.
  /** ONE SCROLLBAR, NOT TWO. */
  const unbounded = scrollBody ? Number.POSITIVE_INFINITY : undefined
  useAutoGrow(textareaRef, content, unbounded, unbounded)

  /* The gutter appears and disappears as the draft crosses the scroll ceiling. */
  useEffect(() => {
    const field = textareaRef.current
    if (field !== null) syncMirror(field)
  }, [content, syncMirror])

  /** The link, lifted out of the text once its card is real. */
  const attached = useAttachedLink()
  /* Above `useDraftLink`, because that now asks whether the author has media. */
  const media = useAttachedMedia(content, setBody)

  /* `setBody`, not `setContent`. */
  const pasted = useAttachedQuote(content, setBody, quoting === undefined)
  const pastedQuote = pasted.quote
  const pastedKey = pastedQuote === undefined ? '' : `${pastedQuote.type}:${pastedQuote.bech32}`

  const draftUrl = useDraftLink(content, uploads.attachments.length > 0 || media.items.length > 0)
  // Nothing is remembered about a dismissed link.
  const candidate = draftUrl
  const cardIsReal = useUnfurl(candidate)
  // `setBody` so the modal's mirror.
  useCaptureWhenReady(attached, candidate, cardIsReal, content, setBody)
  /* `candidate` already asks `attached.dismissed`, which is the hook's own memory. */
  const draftPreview = attached.url ?? candidate

  // Undefined until the early return below has proved otherwise.
  const signer: Signer | undefined = session.status === 'signed' ? session.signer : undefined
  /* Attach what the opener handed. */
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || initialFiles === undefined || initialFiles.length === 0) return
    if (signer === undefined) return
    seeded.current = true
    uploads.add([...initialFiles], signer)
  }, [initialFiles, signer, uploads])
  const trimmed = content.trim()
  /** WHAT COUNTS AS SOMETHING TO POST. */
  const canPost =
    (trimmed !== '' ||
      uploads.urls.length > 0 ||
      media.attached.length > 0 ||
      attached.url !== undefined ||
      pasted.attached !== undefined ||
      quoting !== undefined) &&
    !publishing &&
    !uploads.busy

  /** Reported upward whenever the button's appearance would change. */
  const publishRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    onActions?.({
      canPost,
      publishing,
      uploading: uploads.busy,
      publish: () => publishRef.current(),
    })
  }, [canPost, publishing, uploads.busy, onActions])

  /** Focus on mount when the host asks. */
  useEffect(() => {
    if (!autoFocus) return
    const node = textareaRef.current
    if (node === null) return
    node.focus()
    // Caret at the end, so a resumed draft is continued rather than typed into the middle.
    const end = node.value.length
    node.setSelectionRange(end, end)
  }, [autoFocus])

  const insert = (text: string): void => {
    const node = textareaRef.current
    if (node === null) {
      setBody(current => current + text)
      return
    }
    // Inserted at the caret rather than appended, so picking an emoji mid-sentence lands.
    const start = node.selectionStart
    const end = node.selectionEnd
    setBody(current => current.slice(0, start) + text + current.slice(end))
    requestAnimationFrame(() => {
      node.focus()
      node.selectionStart = node.selectionEnd = start + text.length
    })
  }

  /** The `@handle` under the caret, if any. */
  // Shared with the reply composer: one implementation, so the two cannot drift.
  const mentions = useMentionField(initialMentions)
  /* Re-measured whenever the `@` moves or the text around it changes. */
  const caretAt = useCaretAnchor(
    mirrorRef.current,
    anchorRef.current,
    mentions.query?.start,
    MENTION_PANEL_WIDTH,
    content,
  )

  /* Reported upward so the DRAFT can carry them. */
  useEffect(() => {
    onMentionsChange?.(mentions.bindings)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reports the value, not the callback
  }, [mentions.bindings])

  const lastPubkeyRef = useRef(pubkey)
  useEffect(() => {
    const previous = lastPubkeyRef.current
    lastPubkeyRef.current = pubkey
    // Only a real SWAP, never the first resolve.
    if (previous === undefined || pubkey === undefined || previous === pubkey) return
    // `setBody`, not `setContent`: it is the only writer that tells the host.
    setBody('')
    mentions.clear()
    mentions.dismiss()
  }, [pubkey])

  /* BUILT ONCE, not on every render. */
  /* The whole card, memoised. */
  const quotedPointer = useMemo(
    () =>
      quoting === undefined
        ? undefined
        : { id: quoting.id as never, relays: [] as never[], author: quoting.pubkey as never },
    [quoting?.id, quoting?.pubkey],
  )

  const quotedCard = useMemo(
    () => (quotedPointer === undefined ? null : <QuotedNote pointer={quotedPointer} />),
    [quotedPointer],
  )

  /** A POINTER TYPED OR PASTED INTO THE TEXT, previewed like every other attachment. */
  const pastedCard = useMemo(
    () => (pastedQuote === undefined ? null : <DraftQuoteCard quote={pastedQuote} />),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the KEY is the identity, not the object
    [pastedKey],
  )

  /** EVERY HOOK ABOVE THIS LINE, and the reason is not tidiness. */
  if (session.status !== 'signed') {
    const readonly = session.status === 'readonly'
    return (
      // The first thing a visitor with no key ever sees.
      <div className="flex flex-col gap-4 border-b border-border px-4 pb-6 pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5 sm:pt-6">
        <div className="min-w-0">
          {/* Matched to the rail's wordmark, by measurement rather than by eye. */}
          <h2 className="font-brand text-[26px] font-bold leading-[1.15] tracking-tight text-text sm:text-[28px]">
            {readonly ? 'You are reading in view-only mode' : 'Welcome to Nostrich'}
          </h2>
          {/* Sized so the sentence lands on exactly two lines, measured rather than eyeballed. */}
          <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted sm:text-[15px]">
            {readonly
              ? 'You can read everything. Add a key that can sign, and you can post, reply and zap.'
              : 'Nostrich is a new, best-in-class Nostr client for web, iOS, Android & Mac. Your content. Your feed. Your experience.'}
          </p>
        </div>
        {/* shrink-0 so a long headline never squeezes the button into two lines. */}
        <Link
          href="/login"
          // The cream from the logo's own background, so the welcome banner's call to action.
          className="inline-flex w-full shrink-0 items-center justify-center rounded-lg bg-[#f0dfc6] px-6 py-2.5 font-brand text-[16px] font-semibold text-[#1F1B18] transition-opacity hover:opacity-90 sm:w-auto"
        >
          Start here
        </Link>
      </div>
    )
  }

  const applyMention = (chosen: Hex, name: string): void => {
    mentions.apply(textareaRef.current, textareaRef.current?.value ?? content, chosen, name, setBody)
  }

  const publish = async (): Promise<void> => {
    if (!canPost || signer === undefined) return
    setPublishing(true)
    setError(null)
    setResults(null)

    let signed: NostrEvent
    try {
      // p/t/q tags come from the text itself, so a mention actually notifies and a hashtag.
      const written = mentions.resolve(trimmed)
      // The quote pointer goes last, after the author's words and any uploads.
      const quotePointer =
        quoting === undefined ? '' : `nostr:${encodeNevent({ id: quoting.id, author: quoting.pubkey })}`
      // The captured link goes back into the note.
      /* The lifted pointer goes back in, exactly like the lifted link above. */
      const pastedPointer = pasted.attached ?? ''
      /* Pasted media rides with the uploads, because to a reader they are the same thing. */
      const body = [
        written,
        ...uploads.urls,
        ...media.attached,
        attached.url ?? '',
        quotePointer,
        pastedPointer,
      ]
        .filter(part => part !== '')
        .join('\n\n')
      const references = referencesFromContent(body)
      const tags: string[][] = [...uploads.imetaTags]
      // Tracked so a person mentioned in the text AND quoted below it is p-tagged.
      const mentioned = new Set<string>()
      const addPerson = (pubkey: string): void => {
        if (pubkey === '' || mentioned.has(pubkey)) return
        mentioned.add(pubkey)
        tags.push(['p', pubkey])
      }
      for (const pubkey of references.pubkeys) addPerson(pubkey)
      /** A `q` tag names WHO was quoted, not just. */
      for (const id of references.eventIds) {
        const author = getCachedEvent(id)?.pubkey
        tags.push(author === undefined ? ['q', id] : ['q', id, '', author])
        /** And a `p` tag for them, which is what actually TELLS them. */
        if (author !== undefined) addPerson(author)
      }
      for (const tag of references.hashtags) tags.push(['t', tag])

      signed = await signer.signEvent(buildShortNote(body, { tags }))
    } catch (cause) {
      setError(messageOf(cause))
      setPublishing(false)
      return
    }

    // A signer holding several identities can sign as one the header does not show.

    // The return is deliberately ignored.
    if (signed.pubkey !== session.pubkey) {
      void adopt({ status: 'signed', pubkey: signed.pubkey, signer })
    }

    setBody('')
    attached.reset()
    // Cleared with the rest of the draft, or the next note starts holding the last one's.
    pasted.reset()
    media.reset()
    uploads.clear()
    // With the rest of the draft: a token remembered past the note it was picked.
    mentions.clear()
    // The panel is keyed on a query that no longer matches anything, and focus goes.
    mentions.dismiss()
    /** ANNOUNCED ONCE, HERE, so no host can forget. */
    announcePublished(signed)
    onPublished(signed)

    /** SENT TO THE PEOPLE IT ADDRESSES, not only to the reader's own relays. */
    const addressed = [
      ...new Set(
        signed.tags
          .filter(tag => tag[0] === 'p' && typeof tag[1] === 'string')
          .map(tag => tag[1] as Hex),
      ),
    ]
    // Undefined means the reader's own relays, which is what the pool does by default.
    const outcome = await getPool().publish(signed)
    setResults(outcome)
    setPublishing(false)
    if (!outcome.some(result => result.ok)) onRejected(signed.id)
    textareaRef.current?.focus()
  }

  // Pointed at the current closure on every render, so the host's Post button always.
  publishRef.current = () => void publish()

  const accepted = results?.filter(result => result.ok) ?? []
  const name = profileDisplayName(profile ?? { pubkey: session.pubkey })

  return (
    <div className={`px-4 py-3.5 sm:px-5 ${bordered ? 'border-b border-border' : ''}`}>
      <div className="flex gap-3">
        {/* Still a link. */}
        <Link href={`/p/${npubOf(session.pubkey)}`} aria-label="Your profile" className="shrink-0">
          <Avatar pubkey={session.pubkey} name={name} picture={profile?.picture} />
        </Link>
        {/* `relative` so the mention picker can anchor to the field rather than to the page. */}
        <div className="relative min-w-0 flex-1">
          <label htmlFor={fieldId} className="sr-only">
            Write a note
          </label>
          {/** THE DRAFT SCROLLS; THE TOOLBAR DOES NOT. Everything the draft can grow by lives in here, the. */}
          {/* `overscroll-y-contain`, so reaching the end of the draft does not start scrolling. */}
          <div
            className={
              scrollBody ? 'sm:max-h-[60vh] sm:overflow-y-auto sm:overscroll-y-contain sm:pr-1' : undefined
            }
          >
          {/* The field and its highlight layer share this box, so `inset-0` on the mirror. */}
          <div className="relative">
          <DraftHighlight value={content} mentions={mentions.tokens} trackRef={mirrorRef} />
          <textarea
            /* Connects the field to the popup for assistive technology. */
            {...mentions.fieldProps}
            id={fieldId}
            ref={textareaRef}
            value={content}
            onChange={event => {
              setBody(event.target.value)
              mentions.sync(event.currentTarget)
            }}
            onKeyUp={event => mentions.sync(event.currentTarget)}
            onScroll={event => syncMirror(event.currentTarget)}
            onClick={event => mentions.sync(event.currentTarget)}
            onBlur={() => mentions.dismiss()}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void publish()
              }
              // Escape dismisses the picker without touching the draft.
              if (event.key === 'Escape' && mentions.query !== undefined) {
                event.preventDefault()
                mentions.dismiss()
              }
            }}
            /** One row when there is a quoted note underneath, two otherwise. */
            rows={quoting === undefined ? 2 : 1}
            placeholder="Share something now..."
            disabled={publishing}
            // No border and no background.

            // `overflow-y-auto` rather than `hidden`: the box grows to MAX_COMPOSER_HEIGHT.
            /** The glyphs are transparent. */
            className={`relative resize-none bg-transparent text-transparent caret-text placeholder:text-text-faint focus:outline-none disabled:opacity-60 ${scrollBody ? 'overflow-hidden' : 'overflow-y-auto'} ${DRAFT_TYPOGRAPHY}`}
          />
          </div>

          {/* Thumbnails of what is attached, with their upload state on them. */}
          {/* ATTACHMENTS AT FULL WIDTH. */}
          {/* The link's own card, while the note is still being written. */}
          {draftPreview !== undefined ? (
            <div className="relative">
              <LinkPreview url={draftPreview} />
              <PreviewDismiss
                onDismiss={() => attached.discard(draftPreview, content, setBody)}
                label="Remove link preview"
              />
            </div>
          ) : null}

          <MediaGateNotice refusal={uploads.refusal} />

          {uploads.attachments.length > 0 ? (
            <DraftMediaRail>
              {uploads.attachments.map(item => (
                <AttachmentPreview key={item.id} item={item}>
                  {item.status !== 'done' ? (
                    <span
                      className={`absolute inset-0 flex items-center justify-center rounded-xl px-1 text-center text-sm font-semibold leading-tight ${
                        item.status === 'failed'
                          ? 'bg-danger-surface/90 text-danger-text'
                          : 'bg-black/55 text-white'
                      }`}
                    >
                      {/* `title` carries every server's own rejection. */}
                      {item.status === 'failed' ? (
                        <span {...(item.detail === undefined ? {} : { title: item.detail })}>
                          {item.error ?? 'Failed'}
                        </span>
                      ) : (
                        'Uploading…'
                      )}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => uploads.remove(item.id)}
                    aria-label={`Remove ${item.file.name}`}
                    /* The dark circle every dismissible attachment uses, moved INSIDE the frame. */
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

          {/* The note being quoted, as the card it will render as once posted. */}
          {quotedCard}
          {/* Beside it, never both: `pastedQuote` is undefined whenever the quote button set. */}
          {pastedCard === null ? null : (
            <div className="relative">
              {pastedCard}
              {/* Puts the pointer back in the draft rather than deleting. */}
              <PreviewDismiss
                onDismiss={() => pasted.dismiss(content, setBody)}
                label="Remove quote preview"
              />
            </div>
          )}
          {/* Media pasted as a URL, previewed like an upload. */}
          <DraftMediaUrls items={media.items} onDismiss={media.dismiss} />
          </div>

          {/* OUTSIDE the scroll region, and it has to be: a scrolling ancestor would clip. */}
          <div ref={anchorRef} className="relative h-0">
            {mentions.query !== undefined ? (
              <MentionPicker
                query={mentions.query}
                viewer={pubkey}
                field={textareaRef.current}
                {...(caretAt === undefined ? {} : { anchor: caretAt })}
                onPick={applyMention}
                onDismiss={mentions.dismiss}
                onActive={mentions.announce}
              />
            ) : null}
          </div>

          {/* `mt-3`, up from `mt-1`. */}
          <div className="relative mt-3 flex items-center justify-between gap-3">
            {/* -ml-2 cancels the tool buttons' own padding. */}
            <div className="-ml-2 flex items-center gap-1">
              {/* Straight to the Blossom servers, never through our box. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={event => {
                  // `session.signer`, not the hoisted `signer`: this JSX only renders past the early.
                  if (event.target.files !== null) uploads.add(event.target.files, session.signer)
                  // Reset so picking the same file twice in a row still fires a change event.
                  event.target.value = ''
                }}
              />
              <ToolButton
                icon="image"
                label="Add photo or video"
                onClick={() => fileRef.current?.click()}
                disabled={publishing}
              />
              {/* DESKTOP ONLY. */}
              <span className="max-sm:hidden">
                <ToolButton
                  icon="mood"
                  label="Add emoji"
                  onClick={() => setEmojiOpen(open => !open)}
                  disabled={publishing}
                />
              </span>
              {emojiOpen ? (
                <EmojiPicker onPick={emoji => insert(emoji)} onClose={() => setEmojiOpen(false)} />
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => void publish()}
              disabled={!canPost}
              aria-busy={publishing}
              // Pill, like the rail's Post button.
              className={`shrink-0 rounded-full bg-text px-5 py-2 text-[15px] font-bold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
                hidePostButton ? 'max-sm:hidden' : ''
              }`}
            >
              {publishing ? 'Publishing…' : uploads.busy ? 'Uploading…' : 'Post'}
            </button>
          </div>
        </div>
      </div>

      {/* Only failure gets a line. */}
      <div aria-live="polite" className="empty:hidden">
        {error !== null ? (
          <p className="mt-3 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        ) : null}

        {results !== null ? (
          <div className="mt-3 text-sm">
            {accepted.length === 0 ? (
              <p className="text-danger-text">No relay accepted this note. It was not published.</p>
            ) : (
              /* Silent on screen, still announced. */
              <p className="sr-only">Note published.</p>
            )}
            {/* No per-relay refusal list, ever. */}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** One toolbar affordance. */

function ToolButton({
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
      className="flex size-9 items-center justify-center rounded-full text-nav-icon transition-colors hover:bg-bg-inset disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}
