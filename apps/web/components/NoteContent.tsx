'use client'

import { Link } from './AppLink'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addressLabel,
  galleryPreset,
  imetaDimFor,
  MEDIA_PRESET_RATIO,
  collapseBlankRuns,
  parseContent,
  profileDisplayName,
  splitMedia,
  type ContentSegment,
  type Hex,
  type NostrEvent,
} from '@nostrich/nostr'

import { useBlossomSrc } from '../lib/blossom-retry'
import { previewBox, useNaturalRatio } from '../lib/preview-fit'
import { truncate } from '../lib/format'
import { trimSegmentEdges } from '../lib/note-segments'
import { entityHref, hashtagHref } from '../lib/links'
import { useProfile } from '../lib/profiles'
import { LINK } from '../lib/styles'
import { ContentLink } from './ContentLink'
import { ProfileHoverCard } from './ProfileHoverCard'
import { TimelineAudio } from './TimelineAudio'
import { TimelineVideo } from './TimelineVideo'

function Mention({
  pubkey,
  bech32,
  inert = false,
}: {
  pubkey: Hex
  bech32: string
  inert?: boolean
}): React.ReactNode {
  const profile = useProfile(pubkey)
  /** The DISPLAY NAME, which is how every other client renders a mention. */
  const name = profileDisplayName(profile ?? { pubkey })
  // `inert` was not threaded here before, so a mention inside a notification preview.
  if (inert) return <span className={`${LINK} font-medium`}>@{name}</span>
  return (
    /* The same card the timeline shows over an author's avatar. */
    <ProfileHoverCard pubkey={pubkey} inline>
      <ContentLink href={entityHref(bech32)} className={`${LINK} font-medium`}>
        @{name}
      </ContentLink>
    </ProfileHoverCard>
  )
}

function Segment({
  segment,
  inert = false,
}: {
  segment: ContentSegment
  /** Render with no anchors of its own. */
  inert?: boolean
}): React.ReactNode {
  switch (segment.type) {
    case 'text':
      return <>{segment.value}</>

    case 'url': {
      const shown = truncate(segment.url.replace(/^https?:\/\//, ''), 64)
      if (inert) return <span className={LINK}>{shown}</span>
      return (
        <ContentLink href={segment.url} className={LINK}>
          {shown}
        </ContentLink>
      )
    }

    case 'image': {
      const picture = (
        <img
          src={segment.url}
          // The author wrote no alt text and none can be invented.
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={`w-full bg-bg-inset object-contain ${inert ? 'max-h-72' : 'max-h-[32rem]'}`}
        />
      )
      if (inert) {
        // Shorter, too: inside a preview this is a reminder of which note, not the note.
        return (
          <span className="mt-2 block overflow-hidden rounded-md border border-border">
            {picture}
          </span>
        )
      }
      return (
        <ContentLink
          href={segment.url}
          className="mt-2 block overflow-hidden rounded-md border border-border"
        >
          {picture}
        </ContentLink>
      )
    }

    case 'video':
      // `inert` is how this renderer is told it is drawing a PREVIEW inside something else.
      return <TimelineVideo src={segment.url} {...(inert === true ? { still: true } : {})} />
    case 'audio':
      return <TimelineAudio src={segment.url} />

    case 'hashtag':
      if (inert) return <span className={LINK}>#{segment.tag}</span>
      return (
        <Link href={hashtagHref(segment.tag)} className={LINK}>
          #{segment.tag}
        </Link>
      )

    case 'emoji':
      return (
        /* Sized in `em` so it grows with the reader's text size and sits on the line rather. */
        <img
          src={segment.url}
          alt={`:${segment.shortcode}:`}
          title={`:${segment.shortcode}:`}
          loading="lazy"
          decoding="async"
          className="mx-[0.05em] inline-block h-[1.25em] w-auto max-w-[6em] align-[-0.25em] object-contain"
        />
      )

    case 'mention':
      return <Mention pubkey={segment.pubkey} bech32={segment.bech32} inert={inert} />

    case 'event': {
      const shown = (
        <>
          {segment.bech32.slice(0, 12)}…
        </>
      )
      if (inert) return <span className={LINK}>{shown}</span>
      return (
        <ContentLink href={entityHref(segment.bech32)} className={LINK}>
          {shown}
        </ContentLink>
      )
    }

    case 'address': {
      /* `addressLabel`, the same function the shared renderer uses. */
      const shown = <>{addressLabel(segment)}</>
      if (inert) return <span className={LINK}>{shown}</span>
      return (
        <ContentLink href={entityHref(segment.bech32)} className={LINK}>
          {shown}
        </ContentLink>
      )
    }

    case 'invoice':
      // The gold reads as lightning and is 26° off the warning ramp, but colour is never.
      return (
        <a
          href={`lightning:${segment.bolt11}`}
          className="my-1 inline-flex items-center gap-1.5 rounded-md border border-zap-border bg-zap-surface px-2 py-1 text-sm font-medium text-zap-text"
        >
          <span aria-hidden="true">⚡</span>
          Lightning invoice
        </a>
      )

    case 'cashu':
      // Rendered, never linked: the token *is* the money, and a click that hands.
      return (
        <span className="my-1 inline-flex items-center gap-1.5 rounded-md bg-bg-inset px-2 py-1 text-sm text-text-muted">
          <span aria-hidden="true">🥜</span>
          Cashu token
        </span>
      )
  }
}

export function NoteContent({
  event,
  hideMedia = false,
  hideEventIds,
  inert = false,
}: {
  event: NostrEvent
  /** Drop image and video segments. */
  hideMedia?: boolean
  /** Event pointers the caller draws itself, as a quote card. */
  hideEventIds?: readonly string[]
  /** Render without anchors, for use inside something that is already a link. */
  inert?: boolean
}): React.ReactNode {
  // One regex scan per note, but it runs for every note in the feed.
  const parsed = useMemo(
    () =>
      // Same tidy the timeline card applies: a run of empty rows in the middle of a note.
      parseContent(event.content, event.tags).map(segment =>
        segment.type === 'text' ? { ...segment, value: collapseBlankRuns(segment.value) } : segment,
      ),
    [event.content, event.tags],
  )
  /* Trimmed at the ends AFTER filtering, never before: what is left. */
  const segments = trimSegmentEdges(
    parsed.filter(segment => {
      if (hideMedia && (segment.type === 'image' || segment.type === 'video')) return false
      return !(segment.type === 'event' && hideEventIds?.includes(segment.id) === true)
    }),
  )

  /** MEDIA IS PULLED OUT AND DRAWN TOGETHER, the way the timeline draws. */
  const { media, rest } = splitMedia(segments)

  return (
    <div className="note-body text-[calc(1rem*var(--content-scale,1))] leading-[1.5] text-text">
      {rest.map((segment, index) => (
        <Segment key={index} segment={segment} inert={inert} />
      ))}
      {media.length > 1 ? (
        <MediaRail media={media} tags={event.tags} author={event.pubkey as Hex} inert={inert} />
      ) : (
        media.map((segment, index) => <Segment key={index} segment={segment} inert={inert} />)
      )}
    </div>
  )
}

/** Two or more pieces of media, on a rail. */
export function MediaRail({
  media,
  tags,
  author,
  inert,
  timeline = false,
}: {
  media: ContentSegment[]
  /** The note's tags, read for a NIP-92 `dim` so a cell is the right shape. */
  tags: readonly (readonly string[])[]
  /** Whose note it is, so their own Blossom servers are tried first when a host stalls. */
  author?: Hex
  inert: boolean
  /** Draw the gallery at the SIZE the timeline draws it, independently of `inert`. */
  timeline?: boolean
}): React.ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)
  /** The rail's own width, which only the pair rule needs. */
  const [viewport, setViewport] = useState(0)

  /** ONE frame for the whole post. */
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map())
  const ratios = media.map(segment => {
    const url = segment.type === 'image' || segment.type === 'video' ? segment.url : ''
    const dim = imetaDimFor(tags, url)
    return dim === undefined ? measured.get(url) : dim.width / dim.height
  })
  const preset = galleryPreset(ratios)
  const presetRatio = MEDIA_PRESET_RATIO[preset]
  const learn = (url: string, ratio: number): void => {
    setMeasured(current =>
      current.has(url) ? current : new Map(current).set(url, ratio),
    )
  }

  /* A PAIR IS NOT A GRID. */
  const pair = timeline && media.length === 2
  const base = inert && !timeline ? RAIL_HEIGHT_INERT : RAIL_HEIGHT
  const heightRatio = (pair ? ratios[0] : undefined) ?? presetRatio
  const cellHeight =
    pair && viewport > 0
      ? Math.min(TWO_UP_MAX_HEIGHT, Math.max(base, Math.round((viewport * TWO_UP_SHARE) / heightRatio)))
      : base
  /** Uniform for a grid. */
  const widthFor = (index: number): number =>
    Math.round(cellHeight * ((pair ? ratios[index] : undefined) ?? presetRatio))

  const measure = (): void => {
    const node = ref.current
    if (node === null) return
    setAtStart(node.scrollLeft <= 1)
    setAtEnd(node.scrollWidth - node.clientWidth - node.scrollLeft <= 1)
    setViewport(node.clientWidth)
  }

  useEffect(measure, [media.length])

  /* The pair height is a function of the column width, so it has to be recomputed. */
  useEffect(() => {
    const node = ref.current
    if (node === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setViewport(node.clientWidth))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const nudge = (direction: 1 | -1): void => {
    const node = ref.current
    if (node === null) return
    // A little less than a full viewport, so the item at the edge stays partly visible.
    node.scrollBy({ left: direction * Math.max(1, node.clientWidth * 0.8), behavior: 'smooth' })
  }

  return (
    <span className="relative mt-2 block">
      <span
        ref={ref}
        onScroll={measure}
        className="no-scrollbar flex gap-2 overflow-x-auto"
      >
        {media.map((segment, index) => (
          <span key={index} className="shrink-0">
            {segment.type === 'image' ? (
              <RailImage
                url={segment.url}
                frame={{ height: cellHeight, width: widthFor(index) }}
                inert={inert}
                onRatio={learn}
                {...(author === undefined ? {} : { author })}
              />
            ) : (
              <Segment segment={segment} inert={inert} />
            )}
          </span>
        ))}
      </span>

      {atStart ? null : <RailArrow direction="left" onPress={() => nudge(-1)} />}
      {atEnd ? null : <RailArrow direction="right" onPress={() => nudge(1)} />}
    </span>
  )
}

/** One picture in a rail, in the frame the POST chose. */
function RailImage({
  url,
  frame,
  inert,
  onRatio,
  author,
}: {
  url: string
  /** The cell, decided by the rail. */
  frame: { height: number; width: number }
  inert: boolean
  onRatio: (url: string, ratio: number) => void
  author?: Hex
}): React.ReactNode {
  /** NOTE MEDIA WALKS THE MIRRORS TOO. */
  const { src, fail, onLoad, exhausted } = useBlossomSrc(url, author)
  const picture = exhausted ? (
    // Every copy tried.
    <span className="size-full bg-bg-inset" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={fail}
      onLoad={event => {
        onLoad()
        const node = event.currentTarget
        if (node.naturalWidth > 0 && node.naturalHeight > 0) {
          onRatio(url, node.naturalWidth / node.naturalHeight)
        }
      }}
      className="size-full bg-bg-inset object-cover"
    />
  )
  const box = 'mt-2 block overflow-hidden rounded-md border border-border'

  if (inert) {
    return (
      <span className={box} style={frame}>
        {picture}
      </span>
    )
  }
  return (
    <ContentLink href={url} className={box} style={frame}>
      {picture}
    </ContentLink>
  )
}

/** One height for every cell, which is what makes a row of photographs read as a strip. */
const RAIL_HEIGHT = 260
/** Shorter inside a quoted card: a reminder of which note, not the note. */
const RAIL_HEIGHT_INERT = 160
/** A pair's share of the column, and the ceiling on how tall that may make. */
const TWO_UP_SHARE = 0.88
const TWO_UP_MAX_HEIGHT = 460

/** The tallest a lone PORTRAIT picture or clip may draw inside a QUOTED CARD. */
export const PREVIEW_MEDIA_MAX_PX = 288

/** The same ceiling on the notifications page, where a portrait may go much taller. */
export const NOTIFICATION_MEDIA_MAX_PX = 460

/** ONE picture, drawn at its own proportions inside a preview. */
export function PreviewImage({
  url,
  tags,
  author,
  cap = PREVIEW_MEDIA_MAX_PX,
}: {
  url: string
  /** Read for a NIP-92 `dim`, so the box is the picture's shape before a byte. */
  tags: readonly (readonly string[])[]
  /** Whose note it is, so their own Blossom servers are tried first when a host stalls. */
  author?: Hex
  /** The height ceiling. Defaults to `PREVIEW_MEDIA_MAX_PX`. */
  cap?: number
}): React.ReactNode {
  const { src, fail, onLoad, exhausted } = useBlossomSrc(url, author)
  /** THE SPACE IS TAKEN UP FRONT where the note says how big the picture. */
  const dim = imetaDimFor(tags, url)
  const natural = useNaturalRatio()
  const ratio = dim === undefined ? natural.ratio : dim.width / dim.height
  const box = previewBox(ratio, cap)
  if (src === undefined || exhausted) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      // Avatars and note media are hosted by strangers.
      referrerPolicy="no-referrer"
      onError={fail}
      onLoad={event => {
        onLoad()
        const node = event.currentTarget
        natural.learn(node.naturalWidth, node.naturalHeight)
      }}
      style={box.style}
      /* `object-contain` for the case where the tag and the file disagree: a wrong `dim`. */
      className={`mt-2 h-auto max-w-full rounded-xl bg-bg-inset ${
        box.sized ? 'w-full object-contain' : 'w-auto'
      }`}
    />
  )
}

function RailArrow({
  direction,
  onPress,
}: {
  direction: 'left' | 'right'
  onPress: () => void
}): React.ReactNode {
  return (
    <button
      type="button"
      aria-label={direction === 'left' ? 'Previous image' : 'More images'}
      onClick={event => {
        // The whole preview is frequently a link.
        event.preventDefault()
        event.stopPropagation()
        onPress()
      }}
      className={`absolute top-1/2 z-10 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white ${
        direction === 'left' ? 'left-2' : 'right-2'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={direction === 'left' ? 'M14.5 6 8.5 12l6 6' : 'M9.5 6l6 6-6 6'} />
      </svg>
    </button>
  )
}
