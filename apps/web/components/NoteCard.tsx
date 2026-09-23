'use client'

import { memo, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MediaServersProvider, NoteCard as SharedNoteCard, type NoteCounts } from '@nostrich/app'
import { Link } from './AppLink'
import {
  KINDS,
  LIVE_EVENT_KIND,
  parseContent,
  profileDisplayName,
  type Hex,
  type NostrEvent,
} from '@nostrich/nostr'

import { absoluteDate, npubOf, relativeTime } from '../lib/format'
import { entityHref, hashtagHref, noteHref, profileHref } from '../lib/links'
import { cachedPfp } from '../lib/blossom-retry'
import { useBlossomServers } from '../lib/blossom-servers'
import { isDeleted, useDeletedVersion } from '../lib/deleted'
import type { ZapDetail } from '../lib/interactions'
import { countedId, displayedNote, repostHints } from '../lib/reposts'
import { rememberProfileHints } from '../lib/profile-hints'
import { useAddressEvent, useAddressTitles, type AddressPointer } from '../lib/addresses'
import { useEdited } from '../lib/edits'
import { ArticleCard } from './ArticleCard'
import { StreamCard } from './StreamCard'
import { useMentionNames, useNip05Verified, useProfile } from '../lib/profiles'
import { useNowSeconds } from './Clock'
import { MediaLightbox } from './MediaLightbox'
import { NoteMenu } from './NoteMenu'
import { isAudioOnly, useAudioOnlyVersion } from '../lib/audio-only'
import { TimelineAudio } from './TimelineAudio'
import { TimelineVideo } from './TimelineVideo'
import { LinkPreview, useUnfurl } from './LinkPreview'
import { previewableUrl } from '../lib/preview-url'
import { Avatar } from './Avatar'
import { InvoiceCard } from './InvoiceCard'
import { useNoteActions } from './useNoteActions'
import { ProfileHoverCard } from './ProfileHoverCard'
import { QuotedNote, quotePointer, useQuotedEvent } from './QuotedNote'
import { ZapStrip } from './ZapStrip'
import { ActionRow } from './ActionRow'
import { ReplyingTo } from './ReplyingTo'
import { RepostHeader } from './RepostHeader'
import { sessionPubkey, useSession } from './SessionProvider'

/** Web adapter for the shared note card. */
function NoteCardImpl({
  event: event_,
  counts,
  zaps,
  collapsedFor,
  hideDivider,
  unfolded,
  tintQuote,
  quoteMediaCap,
}: {
  event: NostrEvent
  counts?: NoteCounts
  /** The individual zaps on this note, for the strip above the action row. */
  zaps?: readonly ZapDetail[]
  /** Why this note is folded, in the reader's words. */
  collapsedFor?: string
  /** The wrapper draws the separator instead. */
  hideDivider?: boolean
  /** Show the whole body with no "Show more". */
  unfolded?: boolean
  /** Fill this note's quoted card instead of leaving it on the page's own ground. */
  tintQuote?: boolean
  /** Portrait ceiling for this note's quoted card. */
  quoteMediaCap?: number
}): React.ReactNode {
  /** A repost renders as the note inside it, under a line saying who amplified. */
  const shown = useMemo(() => displayedNote(event_), [event_])

  // Per-note and per-session.
  const [expanded, setExpanded] = useState(false)

  /** Fetch the reposted note when the envelope did not carry. */
  const missing = useQuotedEvent(
    shown.missingId === undefined
      ? undefined
      : { id: shown.missingId, relays: repostHints(event_) },
  )
  // The fetched original wins as soon as it lands.
  const resolved = shown.missingId !== undefined && missing.event !== undefined ? missing.event : shown.inner

  /** THE NOTE AS ITS AUTHOR LAST MEANT. */
  const { event, edited } = useEdited(resolved)

  // Subscribes to the deleted set.
  useDeletedVersion()
  const profile = useProfile(event.pubkey)
  // A nip05 claim renders as verified only once the well-known document maps it back.
  const verified = useNip05Verified(profile?.nip05, event.pubkey)
  // Zero means the shared clock has not ticked yet (server render, first paint).
  const now = useNowSeconds()

  const router = useRouter()

  /* Where the card is in the page, so a popover raised from inside the react-native. */
  const replyAnchor = useRef<HTMLDivElement | null>(null)
  // Where this author says their media lives, for retrying a dead image.
  const mediaServers = useBlossomServers(event.pubkey)
  const { session } = useSession()

  const [media, setMedia] = useState<string | null>(null)
  const pressRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  /** Every published action on this note, shared with the media viewer. */
  const actions = useNoteActions(event)
  // A `nostr:nevent1…` in the body is a quoted note, not a link to show as base32.
  const quoted = useMemo(() => quotePointer(event), [event])

  /** The quoted pointer always comes out of the body, because the card below always. */
  const quotedIds = useMemo(() => (quoted === undefined ? undefined : [quoted.id]), [quoted])

  /** The link to preview, if this note has earned a card. */
  // The rule itself lives in `lib/preview-url`, because the feed prefetches.
  const previewUrl = useMemo(() => previewableUrl(event), [event])

  /** The URL disappears from the words ONLY once its card is actually on screen. */
  const unfurled = useUnfurl(previewUrl)

  // Mentions render as `@nprofile1qqs…` unless somebody resolves them to a name.
  /* Re-render when a file turns out to be sound rather than video. */
  useAudioOnlyVersion()

  /** The addressable events this note points. */
  const addressed = useMemo(() => {
    const found: AddressPointer[] = []
    for (const segment of parseContent(event.content, event.tags)) {
      if (segment.type !== 'address') continue
      found.push({
        kind: segment.kind,
        pubkey: segment.pubkey,
        identifier: segment.identifier,
        bech32: segment.bech32,
        // Often the only place the event exists.
        ...(segment.relays === undefined ? {} : { relays: segment.relays }),
      })
    }
    return found
  }, [event])
  const titleFor = useAddressTitles(addressed)

  /** The FIRST live stream a note points at becomes a card. */
  const streamPointer = useMemo(
    () => addressed.find(pointer => pointer.kind === LIVE_EVENT_KIND),
    [addressed],
  )
  /* Asked HERE as well as inside the card, and it costs nothing: react-query dedupes. */
  const { event: streamEvent } = useAddressEvent(streamPointer)

  /** An article gets a card too, and only when there is no stream to draw. */
  const articlePointer = useMemo(
    () =>
      streamPointer !== undefined
        ? undefined
        : addressed.find(pointer => pointer.kind === KINDS.longForm),
    [addressed, streamPointer],
  )
  const { event: articleEvent } = useAddressEvent(articlePointer)

  /* The body may only drop a pointer a card actually replaces. */
  const hiddenAddresses = useMemo(() => {
    if (streamPointer !== undefined && streamEvent !== undefined) return [streamPointer.bech32]
    if (articlePointer !== undefined && articleEvent !== undefined) return [articlePointer.bech32]
    return undefined
  }, [streamPointer, streamEvent, articlePointer, articleEvent])

  /** THE URL LEAVES THE WORDS ONLY IF ITS CARD IS THE ONE BEING DRAWN. */
  const previewShown =
    quoted === undefined &&
    streamPointer === undefined &&
    articlePointer === undefined &&
    previewUrl !== undefined &&
    unfurled
  const hiddenUrls = useMemo(
    () => (previewShown && previewUrl !== undefined ? [previewUrl] : undefined),
    [previewShown, previewUrl],
  )

  const mentioned = useMemo(() => {
    const found: Hex[] = []
    for (const segment of parseContent(event.content, event.tags)) {
      if (segment.type !== 'mention') continue
      found.push(segment.pubkey)
      /* The note says where to find them. */
      rememberProfileHints(segment.pubkey, segment.relays)
    }
    return found
  }, [event])
  const nameFor = useMentionNames(mentioned)

  // Signed out, the buttons are not disabled.
  const { requireSigner } = actions

  /** The whole card opens the thread. */
  // The parameter is `click`, not `event`: this file's `event` is the NOTE.
  const openThread = (click: React.MouseEvent<HTMLDivElement>): void => {
    const target = click.target as HTMLElement | null
    if (target?.closest('a, button, input, textarea, select, [role="button"]') !== null) return
    if ((window.getSelection()?.toString() ?? '') !== '') return
    /** The NOTE, never the envelope. */
    router.push(noteHref(event))
  }

  /** A repost whose original has not arrived shows NOTHING, not an empty card. */
  if (shown.missingId !== undefined && missing.event === undefined) return null

  // Hidden rather than tombstoned.
  if (isDeleted(event.id) || isDeleted(event_.id)) return null

  /** The folded state: one row, the reason, and a way out. */
  if (collapsedFor !== undefined && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full cursor-pointer items-center gap-2 border-b border-border px-4 py-3 text-left text-sm text-text-faint transition-colors hover:bg-bg-inset sm:px-5"
      >
        <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
          visibility_off
        </span>
        <span className="min-w-0 flex-1 truncate">{collapsedFor}</span>
        <span className="shrink-0 font-semibold text-text-muted">Show</span>
      </button>
    )
  }

  return (
    <div
      ref={replyAnchor}
      onClick={openThread}
      // Where the last press landed, so a popover raised from inside the react-native.
      onPointerDownCapture={pointerEvent => {
        pressRef.current = { x: pointerEvent.clientX, y: pointerEvent.clientY }
      }}
      // Keyboard users reach the thread through the timestamp link, which is a real anchor.
      /* The zap's card flash finds this by walking up from the row. */
      /* The id, not an empty marker. */
      data-note-card={event.id}
      className="relative cursor-pointer transition-colors hover:bg-bg-elevated"
    >
    {/* Positioned over the card rather than inside. */}
    <div className="absolute right-3 top-3 z-30">
      <NoteMenu event={event} />
    </div>
    {shown.repostedBy === undefined ? null : <RepostHeader pubkey={shown.repostedBy} />}
    <MediaServersProvider servers={mediaServers} cacheUrl={cachedPfp}>
    <SharedNoteCard
      event={event}
      profile={profile}
      verified={verified}
      /* "· edited" beside the time, never instead. */
      timeLabel={`${now === 0 ? absoluteDate(event.created_at) : relativeTime(event.created_at, now)}${
        edited ? ' · edited' : ''
      }`}
      npub={npubOf(event.pubkey)}
      noteHref={noteHref(event)}
      profileHref={profileHref(npubOf(event.pubkey))}
      /* A reply shown out of its thread. */
      beforeContent={<ReplyingTo event={event} />}
      {...(hideDivider === true ? { hideDivider: true } : {})}
      {...(unfolded === true ? { unfolded: true } : {})}
      profileHrefFor={(_hex, bech32) => entityHref(bech32)}
      eventHrefFor={(_hex, bech32) => entityHref(bech32)}
      hashtagHrefFor={hashtagHref}
      addressHrefFor={bech32 => entityHref(bech32)}
      addressTitleFor={titleFor}
      counts={counts}
      /** One occupant, and now it is only ever something the note points. */
      quote={
        quoted !== undefined ? (
          <QuotedNote
            pointer={quoted}
            tinted={tintQuote ?? false}
            {...(quoteMediaCap === undefined ? {} : { mediaCap: quoteMediaCap })}
          />
        ) : streamPointer !== undefined ? (
          /* AHEAD OF THE LINK PREVIEW, deliberately. */
          <StreamCard pointer={streamPointer} />
        ) : articlePointer !== undefined ? (
          // Same argument, and stronger: an article naddr and its njump link are the same piece.
          <ArticleCard pointer={articlePointer} />
        ) : previewUrl === undefined ? undefined : (
          <LinkPreview url={previewUrl} />
        )
      }
      hideEventIds={quotedIds}
      hideAddresses={hiddenAddresses}
      hideUrls={hiddenUrls}
      nameFor={nameFor}
      renderVideo={(url, opts) => (
        <TimelineVideo src={url} {...(opts?.railHeight === undefined ? {} : { railHeight: opts.railHeight })} />
      )}
      renderAudio={url => <TimelineAudio src={url} />}
      isAudioOnly={isAudioOnly}
      /** The avatar, wrapped in a profile card that opens on hover. */
      /** THE WEB ROW, replacing the shared card's own. */
      renderActions={() => (
        <>
          {/* Above the icons, and only when somebody has zapped. */}
          {<ZapStrip zaps={zaps ?? []} noteId={countedId(event)} />}
        <ActionRow
          counts={counts}
          liked={actions.liked}
          reposted={actions.reposted}
          zapped={actions.zapped}
          bookmarked={actions.bookmarked}
          onReply={() => {
            if (!requireSigner()) return
            router.push(noteHref(event))
          }}
          onLike={actions.onLike}
          onRepost={() => actions.onRepost(pressRef.current)}
          onBookmark={actions.onBookmark}
          onZapTap={actions.onZapTap}
          onZapMenu={actions.onZapMenu}
        />
        </>
      )}
      renderInvoice={bolt11 => <InvoiceCard bolt11={bolt11} />}
      renderAvatar={() => (
        /* Marked so a wrapper can measure where the avatar actually ends. */
        <span data-note-avatar="" className="relative z-20 flex self-start">
        <ProfileHoverCard pubkey={event.pubkey}>
          <Link href={profileHref(npubOf(event.pubkey))} aria-label={`Profile of ${npubOf(event.pubkey).slice(0, 12)}`}>
            <Avatar
              pubkey={event.pubkey}
              name={profileDisplayName(profile ?? { pubkey: event.pubkey })}
              picture={profile?.picture}
              size="lg"
            />
          </Link>
        </ProfileHoverCard>
        </span>
      )}
      badgeMine={event.pubkey === sessionPubkey(session)}
      headerGutter
      liked={actions.liked}
      reposted={actions.reposted}
      zapped={actions.zapped}
      // Replying happens in the thread view, where the parent is in front.
      onReply={() => {
        if (!requireSigner()) return
        router.push(noteHref(event))
      }}
      onLike={actions.onLike}
      /** Opens the menu. */
      onRepost={() => actions.onRepost(pressRef.current)}
      onZap={actions.onZapMenu}
      bookmarked={actions.bookmarked}
      onBookmark={actions.onBookmark}
      onOpenMedia={setMedia}
    />
    </MediaServersProvider>
    {/* Rendered as a sibling, not a child: a <dialog> inside the clickable card would put. */}
    {media !== null ? (
      <MediaLightbox event={event} src={media} onClose={() => setMedia(null)} />
    ) : null}

    {/* The repost menu, the quote composer and the zap dialog, all three from the hook. */}
    {actions.overlays}
    </div>
  )
}

/** Memoised on the event, whose identity is stable across feed flushes. */
export const NoteCard = memo(NoteCardImpl)
