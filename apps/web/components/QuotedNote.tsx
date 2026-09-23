'use client'

import { Link } from './AppLink'
import { MediaRail, PreviewImage, PREVIEW_MEDIA_MAX_PX } from './NoteContent'
import { TimelineAudio } from './TimelineAudio'
import { TimelineVideo } from './TimelineVideo'
import { useBlossomSrc } from '../lib/blossom-retry'
import { ContentLink } from './ContentLink'
import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { quotedNoteKey } from '../lib/quote-key'
import { quotedPieces as buildPieces, type QuotedPiece as Piece } from '../lib/quoted-pieces'
import {
  DEFAULT_INDEXER_RELAYS,
  fetchAuthorWriteRelays,
  fetchEventByPointer,
  getTags,
  parseContent,
  splitMedia,
  profileDisplayName,
  profileHandle,
  quotedAuthorFromTags,
  KINDS,
  LIVE_EVENT_KIND,
  type Hex,
  type NostrEvent,
} from '@nostrich/nostr'

import { asset } from '../lib/assets'
import { getCachedEvent, rememberEventsPersisted } from '../lib/event-cache'
import { absoluteDate, npubOf, relativeTime, truncate } from '../lib/format'
import { noteHref, profileHref } from '../lib/links'
import { ArticleCardView } from './ArticleCard'
import { StreamCardView } from './StreamCard'
import { LINK } from '../lib/styles'
import { getPool } from '../lib/pool'
import { rememberProfileHints } from '../lib/profile-hints'
import { previewableUrl } from '../lib/preview-url'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { sessionPubkey, useSession } from './SessionProvider'
import { Avatar } from './Avatar'
import { LinkPreview, useUnfurl } from './LinkPreview'
import { VerifiedBadge } from './VerifiedBadge'
import { useNowSeconds } from './Clock'

/** A note quoted inside another note. */

/** Where a quote pointer can come from, in the order NIP-18 and NIP-21 define them. */
export interface QuotePointer {
  id: Hex
  /** Relay hints carried by the pointer, so an event our own relays lack is still. */
  relays: string[]
  /** Who wrote the quoted note, when anything in the quoting note says. */
  author?: Hex
}

export function quotePointer(event: NostrEvent): QuotePointer | undefined {
  const withAuthor = (pointer: QuotePointer): QuotePointer => {
    if (pointer.author !== undefined) return pointer
    // The pointer itself did not name anyone, so fall back to what the note's tags imply.
    const author = quotedAuthorFromTags(event, pointer.id)
    return author === undefined ? pointer : { ...pointer, author }
  }

  // NIP-18's `q` tag is the explicit signal and wins: a client that set it meant.
  for (const tag of getTags(event, 'q')) {
    const id = tag[1]
    if (id !== undefined && /^[0-9a-f]{64}$/.test(id)) {
      const relay = tag[2]
      const author = tag[3]
      return withAuthor({
        id,
        relays: relay === undefined || relay === '' ? [] : [relay],
        ...(author !== undefined && /^[0-9a-f]{64}$/.test(author) ? { author } : {}),
      })
    }
  }

  // Otherwise the first event reference in the body.
  for (const segment of parseContent(event.content, event.tags)) {
    if (segment.type === 'event') {
      return withAuthor({
        id: segment.id,
        relays: [...(segment.relays ?? [])],
        ...(segment.author === undefined ? {} : { author: segment.author }),
      })
    }
  }
  return undefined
}

/** The quoted event, and whether we are still looking. */
export function useQuotedEvent(pointer: QuotePointer | undefined): {
  event: NostrEvent | undefined
  loading: boolean
} {
  const cached = pointer === undefined ? undefined : getCachedEvent(pointer.id)
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: quotedNoteKey(pointer),
    queryFn: async (): Promise<NostrEvent | null> => {
      if (pointer === undefined) return null
      /** Hints, then our relays, then the author's own. */
      const found = await fetchEventByPointer(getPool(), pointer as never, {
        indexers: DEFAULT_INDEXER_RELAYS,
        timeoutMs: 6_000,
        /** Relay lists are cached per AUTHOR, not per quote. */
        writeRelaysFor: author =>
          queryClient.fetchQuery({
            queryKey: ['relay-list', author],
            queryFn: () =>
              fetchAuthorWriteRelays(getPool(), author, {
                indexers: DEFAULT_INDEXER_RELAYS,
                timeoutMs: 6_000,
              }),
            staleTime: 30 * 60_000,
            gcTime: 60 * 60_000,
          }),
      })
      // Persisted, so a reload does not ask the network for it again.
      if (found !== undefined) rememberEventsPersisted([found])
      return found ?? null
    },
    /* Not while the batch. */
    enabled: pointer !== undefined && cached === undefined,
    // A quote that could not be found stays not-found.
    retry: false,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  })

  return {
    event: cached ?? query.data ?? undefined,
    loading: pointer !== undefined && cached === undefined && query.isPending,
  }
}

/** THE CARD'S OWN GROUND, for the places a quote has to read as a separate note. */
const QUOTE_TINT = 'bg-bg-inset border-border-inset'

export function QuotedNote({
  pointer,
  asLink = true,
  tinted = false,
  inert = false,
  mediaCap = PREVIEW_MEDIA_MAX_PX,
}: {
  pointer: QuotePointer
  /** False when the card sits inside something that is already an anchor. */
  asLink?: boolean
  /* There was a `hideMedia` here, set by the notification preview, and it is gone. */
  /** Fill the card instead of leaving it on the page's own ground. */
  tinted?: boolean
  /** The card is INSIDE an anchor, so it may not open one of its own. */
  inert?: boolean
  /** How tall a lone PORTRAIT picture or clip in this card may go. */
  mediaCap?: number
}): React.ReactNode {
  const { event, loading } = useQuotedEvent(pointer)

  if (event === undefined) {
    /** A quote nobody can serve still gets a card. */
    if (!loading) {
      const missing = `mt-3 block rounded-2xl border px-4 py-3 text-sm text-text-faint ${
        tinted ? QUOTE_TINT : 'border-border'
      }`
      // Inside an anchor there is no link to offer.
      if (inert) return <span className={missing}>This note could not be loaded</span>
      return (
        <Link
          href={noteHref({ id: pointer.id } as NostrEvent)}
          onClick={clickEvent => clickEvent.stopPropagation()}
          className={`${missing} transition-colors ${tinted ? 'hover:bg-hover' : 'hover:bg-bg-inset'}`}
        >
          This note could not be loaded
        </Link>
      )
    }
    /* The bars have to be visible against whatever the card is filled with, and `bgInset`. */
    const bar = tinted ? 'bg-border' : 'bg-bg-inset'
    return (
      <div
        className={`mt-3 rounded-2xl border px-4 py-3 ${tinted ? QUOTE_TINT : 'border-border'}`}
        aria-hidden="true"
      >
        <div className="flex items-center gap-2">
          <div className={`size-8 animate-pulse rounded-full ${bar} motion-reduce:animate-none`} />
          <div className={`h-3 w-28 animate-pulse rounded-sm ${bar} motion-reduce:animate-none`} />
        </div>
        <div className={`mt-2 h-3 w-full animate-pulse rounded-sm ${bar} motion-reduce:animate-none`} />
        <div className={`mt-1.5 h-3 w-3/5 animate-pulse rounded-sm ${bar} motion-reduce:animate-none`} />
      </div>
    )
  }

  /** AN ADDRESSABLE EVENT GETS ITS OWN CARD, EVEN WHEN QUOTED BY ID. */
  if (event.kind === KINDS.longForm) return <ArticleCardView event={event} />
  if (event.kind === LIVE_EVENT_KIND) return <StreamCardView event={event} href={noteHref(event)} />

  return <QuoteCard event={event} asLink={asLink} tinted={tinted} inert={inert} mediaCap={mediaCap} />
}

function QuoteCard({
  event,
  asLink,
  tinted,
  inert,
  mediaCap,
}: {
  event: NostrEvent
  asLink: boolean
  tinted: boolean
  /** The portrait ceiling for this card's media. */
  mediaCap: number
  /** Sitting inside somebody else's anchor. */
  inert: boolean
}): React.ReactNode {
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const profile = useProfile(event.pubkey)
  const verified = useNip05Verified(profile?.nip05, event.pubkey)
  const now = useNowSeconds()
  const name = profileDisplayName(profile ?? { pubkey: event.pubkey })
  /* `profileHandle` is the same source every other surface uses, and it deliberately. */
  const chosenHandle = profileHandle(profile)
  const handle = chosenHandle === undefined ? undefined : `@${chosenHandle}`
  /** THE QUOTED NOTE KEEPS ITS LINK CARD. */
  const preview = previewableUrl(event)
  /* The URL leaves the words only once its card is really on screen. */
  const unfurled = useUnfurl(preview)
  const pieces = buildPieces(event, preview !== undefined && unfurled ? preview : undefined)
  // A note that is nothing but a mention still has something to show, so emptiness.
  const empty = pieces.every(piece => typeof piece === 'string' && piece.trim() === '')
  /** EVERY picture, not just the first. */
  // Memoised: a fresh array each render changes `MediaRail`'s props identity.
  const media = useMemo(() => splitMedia(parseContent(event.content, event.tags)).media, [event])
  // A lone still keeps its bespoke treatment below: sized to the picture's own shape.
  const only = media.length === 1 ? media[0] : undefined
  const image = only !== undefined && only.type === 'image' ? only.url : undefined
  /* A LONE CLIP KEEPS ITS OWN SHAPE, exactly as a lone picture does. */
  const lone =
    only !== undefined && (only.type === 'video' || only.type === 'audio') ? only : undefined
  /* The rail keeps everything else, INCLUDING a single segment that is neither picture. */
  const railed =
    media.length > 1 || (only !== undefined && only.type !== 'image' && lone === undefined)

  /* The hover has to move OFF whatever the card is already sitting. */
  const className = `mt-3 block rounded-2xl border px-4 py-3 ${
    tinted ? QUOTE_TINT : 'border-border'
  }${asLink ? (tinted ? ' transition-colors hover:bg-hover' : ' transition-colors hover:bg-bg-inset') : ''}`
  /* A STRETCHED link, not a wrapping one. */
  /** NOT A COMPONENT. */
  const content = (
    <>
      {/* TWO gaps, not one. */}
      <span className="flex items-center gap-2">
        <Avatar pubkey={event.pubkey} name={name} picture={profile?.picture} size="sm" />
        <span className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate text-[15px] font-bold text-text">{name}</span>
        {verified ? (
          <VerifiedBadge size={15} mine={event.pubkey === viewer} />
        ) : null}
        {/* The @handle, which every other note header carries and this one did. */}
        {handle === undefined ? null : (
          <span className="min-w-0 shrink truncate text-sm text-text-faint">{handle}</span>
        )}
        <span aria-hidden="true" className="shrink-0 text-text-faint">
          ·
        </span>
        <span className="shrink-0 text-sm text-text-faint">
          {now === 0 ? absoluteDate(event.created_at) : relativeTime(event.created_at, now)}
        </span>
        </span>
      </span>

      {/* Clamped text, then the picture. */}
      {empty ? null : (
        <span
          data-note-body
          className="mt-1.5 line-clamp-6 whitespace-pre-wrap break-words leading-relaxed text-text"
        >
          <QuotedBody pieces={pieces} inert={inert} />
        </span>
      )}

      {preview === undefined ? null : <LinkPreview url={preview} inert />}

      {railed ? (
        /* `pointer-events-auto`, so the rail can actually be scrolled. */
        inert ? (
          <span className="pointer-events-auto relative block">
            <MediaRail media={media} tags={event.tags} author={event.pubkey as Hex} inert />
          </span>
        ) : (
          <Link
            href={noteHref(event)}
            onClick={clickEvent => clickEvent.stopPropagation()}
            aria-label={media.length === 1 ? 'Attached media' : `${media.length} images`}
            className="pointer-events-auto relative block"
          >
            <MediaRail media={media} tags={event.tags} author={event.pubkey as Hex} inert />
          </Link>
        )
      ) : image !== undefined ? (
        <PreviewImage url={image} tags={event.tags} author={event.pubkey as Hex} cap={mediaCap} />
      ) : lone === undefined ? null : lone.type === 'audio' ? (
        <TimelineAudio src={lone.url} />
      ) : (
        /* `pointer-events-auto` for the same reason the rail has it: the card's content. */
        <span className="pointer-events-auto mt-2 block">
          <TimelineVideo src={lone.url} still maxHeight={mediaCap} />
        </span>
      )}
    </>
  )

  return asLink ? (
    <span className={`${className} relative`}>
      <Link
        href={noteHref(event)}
        // The outer card is already clickable.
        onClick={clickEvent => clickEvent.stopPropagation()}
        aria-label={`Note by ${name}`}
        className="absolute inset-0 rounded-2xl"
      />
      <span className="pointer-events-none relative block">{content}</span>
    </span>
  ) : (
    <span className={className}>{content}</span>
  )
}

/** One pass over a quoted note's content, condensed for a preview. */
export type { QuotedPiece } from '../lib/quoted-pieces'
export { quotedPieces, plainText } from '../lib/quoted-pieces'

/** The same text, with mentions resolved to names. */
function QuotedMention({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const profile = useProfile(pubkey)
  /* Styled like a mention even though it cannot BE one. */
  return (
    <span className="text-link font-semibold">@{profileDisplayName(profile ?? { pubkey })}</span>
  )
}

/** A link inside a quoted card, and a real one. */
function QuotedLink({ url, inert }: { url: string; inert: boolean }): React.ReactNode {
  const shown = truncate(url.replace(/^https?:\/\//, ''), 48)
  // Inside something that is already a link, an anchor cannot be nested.
  if (inert) return <span className="text-link font-semibold">{shown}</span>
  return (
    <ContentLink
      href={url}
      onClick={event => event.stopPropagation()}
      className={`${LINK} pointer-events-auto relative`}
    >
      {shown}
    </ContentLink>
  )
}

export function QuotedBody({
  pieces,
  inert = false,
}: {
  pieces: readonly Piece[]
  /** For a caller whose whole row is already an anchor: the rail panels. */
  inert?: boolean
}): React.ReactNode {
  return (
    <>
      {pieces.map((piece, index) => {
        if (typeof piece === 'string') {
          // Trim only the outer edges, the way `plainText` does.
          return index === 0 ? piece.trimStart() : index === pieces.length - 1 ? piece.trimEnd() : piece
        }
        return 'url' in piece ? (
          // eslint-disable-next-line react/no-array-index-key -- pieces are positional
          <QuotedLink key={index} url={piece.url} inert={inert} />
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- pieces are positional
          <QuotedMention key={index} pubkey={piece.pubkey} />
        )
      })}
    </>
  )
}

