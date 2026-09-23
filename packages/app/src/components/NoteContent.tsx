import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { SvgImage } from './svg-image'
import { useMediaCacheUrl, useMediaServers } from './media-servers'
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
  type DimensionValue,
  type TextProps,
} from 'react-native'
import {
  collapseBlankRuns,
  mergeTextSegments,
  galleryPreset,
  imetaDimFor,
  isPrivateUrl,
  MEDIA_PRESET_RATIO,
  parseContent,
  truncateSegments,
  BODY_LIMIT,
  shortNpub,
  splitMedia,
  type ContentSegment,
  type NostrEvent,
  blossomAlternatives,
  DEFAULT_BLOSSOM_SERVERS,
  noteHostFailure,
  noteHostSuccess,
  reorderByHealth,
  imetaThumbFor,
  addressLabel,
} from '@nostrich/nostr'

import { Link } from '../nav'
import { makeStyles, useTheme } from '../theme'

/** Note body, rendered on every platform. */
/** The whitespace left behind by a segment that has just been removed. */
function trimExposedEdges(segments: ContentSegment[]): ContentSegment[] {
  /* MERGED FIRST, and the order is the whole fix. */
  const out = mergeTextSegments(segments).map(segment =>
    // A note pasted in from elsewhere arrives with rows of nothing.
    segment.type === 'text' ? { type: 'text' as const, value: collapseBlankRuns(segment.value) } : segment,
  )

  while (out.length > 0) {
    const first = out[0]
    if (first?.type !== 'text') break
    const trimmed = first.value.replace(/^\s+/u, '')
    if (trimmed === '') {
      out.shift()
      continue
    }
    out[0] = { type: 'text', value: trimmed }
    break
  }

  while (out.length > 0) {
    const last = out[out.length - 1]
    if (last?.type !== 'text') break
    const trimmed = last.value.replace(/\s+$/u, '')
    if (trimmed === '') {
      out.pop()
      continue
    }
    out[out.length - 1] = { type: 'text', value: trimmed }
    break
  }

  return out
}

export function NoteContent({
  event,
  profileHref,
  eventHref,
  hashtagHref,
  addressHref,
  addressTitle,
  onOpenMedia,
  hideEventIds,
  hideAddresses,
  hideUrls,
  nameFor,
  renderVideo,
  renderAudio,
  isAudioOnly,
  renderInvoice,
  beforeMedia,
  unfolded,
}: {
  event: NostrEvent
  /** Start with the whole body shown, and no "Show more". */
  unfolded?: boolean
  profileHref: (pubkeyHex: string, bech32: string) => string
  eventHref: (idHex: string, bech32: string) => string
  hashtagHref: (tag: string) => string
  /** Where an `naddr` points. */
  addressHref?: (bech32: string) => string
  /** The addressable event's own `title`, when the host has resolved. */
  addressTitle?: (segment: { kind: number; pubkey: string; identifier: string }) => string | undefined
  /** Host opens a full-screen viewer. */
  onOpenMedia?: (url: string) => void
  /** Event references the host is rendering as a quote card instead. */
  hideEventIds?: readonly string[]
  /** Addressable pointers the host is drawing as a card instead. */
  hideAddresses?: readonly string[]
  /** Links the host is rendering as a preview card instead. */
  hideUrls?: readonly string[]
  /** A mentioned account's display name, when the host knows. */
  nameFor?: (pubkeyHex: string) => string | undefined
  /** A player for a video URL, supplied by the host. */
  renderVideo?: (url: string, opts?: { railHeight?: number }) => React.ReactNode
  /** Same escape hatch as `renderVideo`: the web app hands down a real player. */
  renderAudio?: (url: string) => React.ReactNode
  /** Whether a URL that claims to be video is actually sound. */
  isAudioOnly?: (url: string) => boolean
  /** A payable lightning invoice, supplied by the host. */
  renderInvoice?: (bolt11: string) => React.ReactNode
  /** Rendered between the body text and the media. */
  beforeMedia?: React.ReactNode
}): React.ReactNode {
  const theme = useTheme()
  const s = styles(theme)
  const segments = useMemo(() => parseContent(event.content, event.tags), [event])

  // Images render below the text rather than inline: React Native has no inline-image.
  /** Media, minus anything pointing at the reader's own network. */
  const media = segments.filter(
    (seg): seg is ContentSegment & { type: 'image' | 'video'; url: string } =>
      (seg.type === 'image' || seg.type === 'video') &&
      !isPrivateUrl(seg.url) &&
      !(seg.type === 'video' && isAudioOnly?.(seg.url) === true),
  )
  /** Sound is kept OUT of the rail above, deliberately. */
  const sounds = segments.filter(
    (seg): seg is ContentSegment & { type: 'audio' | 'video'; url: string } =>
      (seg.type === 'audio' || (seg.type === 'video' && isAudioOnly?.(seg.url) === true)) &&
      !isPrivateUrl(seg.url),
  )
  /* `splitMedia` rather than a filter, for the whitespace it takes. */
  /* FOLDED IF IT IS LONG, and only. */
  const inline = trimExposedEdges(
    splitMedia(segments).rest.filter(
      seg =>
        !(seg.type === 'event' && hideEventIds?.includes(seg.id) === true) &&
        !(seg.type === 'address' && hideAddresses?.includes(seg.bech32) === true) &&
        !(seg.type === 'url' && hideUrls?.includes(seg.url) === true),
    ),
  )

  /** Whether there is anything to say above the picture. */
  const hasBody = inline.some(seg =>
    seg.type === 'text' ? seg.value.trim() !== '' : true,
  )

  /** THE NOTE'S OWN PAGE SHOWS THE NOTE, not a preview of it with a button. */
  const [expanded, setExpanded] = useState(unfolded === true)
  const folded = useMemo(() => truncateSegments(inline), [inline])
  const body = expanded ? inline : folded.shown

  return (
    <View>
      {hasBody ? (
        <Text style={s.body} selectable {...NOTE_BODY_ATTRS}>
          {body.map((segment, index) => (
            <Segment
              key={index}
              segment={segment}
              profileHref={profileHref}
              eventHref={eventHref}
              hashtagHref={hashtagHref}
              addressHref={addressHref}
              addressTitle={addressTitle}
              nameFor={nameFor}
              renderInvoice={renderInvoice}
            />
          ))}
          {folded.truncated && !expanded ? <Text style={s.muted}>… </Text> : null}
        </Text>
      ) : null}

      {/* SHOW MORE, in the body's own column. */}
      {folded.truncated && !expanded ? (
        <Text
          style={s.showMore}
          onPress={event => {
            ;(event as unknown as { stopPropagation?: () => void }).stopPropagation?.()
            setExpanded(true)
          }}
        >
          Show more
        </Text>
      ) : null}
      {beforeMedia}

      {/* SOUND FIRST, then the pictures. */}
      {sounds.map((segment, index) =>
        renderAudio !== undefined ? (
          <View key={index} style={s.sound}>
            {renderAudio(segment.url)}
          </View>
        ) : (
          /* Native has no player yet. A link that says what it is beats a link that does. */
          <Text key={index} style={s.link} onPress={() => void Linking.openURL(segment.url)}>
            ♪ {shorten(segment.url)}
          </Text>
        ),
      )}

      {/* Two or more ATTACHMENTS scroll sideways instead of stacking. */}
      {media.length > 1 ? (
        <ImageRail
          images={media}
          tags={event.tags}
          onOpenMedia={onOpenMedia}
          flush={!hasBody}
          {...(renderVideo === undefined ? {} : { renderVideo })}
        />
      ) : null}

      {media.length > 1
        ? null
        : media.map((segment, index) =>
            segment.type === 'image' ? (
              <NoteImage
                key={index}
                uri={segment.url}
                tags={event.tags}
                onOpen={onOpenMedia}
                flush={!hasBody}
              />
            ) : segment.type === 'video' ? (
              renderVideo !== undefined ? (
                <View key={index}>{renderVideo(segment.url)}</View>
              ) : (
                <Text key={index} style={s.link} onPress={() => void Linking.openURL(segment.url)}>
                  ▶ {shorten(segment.url)}
                </Text>
              )
            ) : null,
          )}

    </View>
  )
}

function Segment({
  nameFor,
  segment,
  profileHref,
  eventHref,
  hashtagHref,
  addressHref,
  addressTitle,
  renderInvoice,
}: {
  segment: ContentSegment
  profileHref: (pubkeyHex: string, bech32: string) => string
  eventHref: (idHex: string, bech32: string) => string
  hashtagHref: (tag: string) => string
  /** Where an naddr points. */
  addressHref?: (bech32: string) => string
  /** The addressable event's own `title`, once the host has resolved. */
  addressTitle?: (segment: { kind: number; pubkey: string; identifier: string }) => string | undefined
  nameFor?: (pubkeyHex: string) => string | undefined
  /** A player for a video URL, supplied by the host. */
  renderVideo?: (url: string, opts?: { railHeight?: number }) => React.ReactNode
  /** Same escape hatch as `renderVideo`: the web app hands down a real player. */
  renderAudio?: (url: string) => React.ReactNode
  /** Whether a URL that claims to be video is actually sound. */
  isAudioOnly?: (url: string) => boolean
  /** A payable lightning invoice, supplied by the host. */
  renderInvoice?: (bolt11: string) => React.ReactNode
}): React.ReactNode {
  const theme = useTheme()
  const s = styles(theme)

  switch (segment.type) {
    case 'text':
      return <Text style={s.body} {...NOTE_BODY_ATTRS}>{segment.value}</Text>
    case 'url':
      return (
        <Text style={s.link} onPress={() => void Linking.openURL(segment.url)}>
          {shorten(segment.url)}
        </Text>
      )
    case 'hashtag':
      return (
        <Link href={hashtagHref(segment.tag)}>
          <Text style={s.link}>#{segment.tag}</Text>
        </Link>
      )
    case 'emoji':
      /* A custom emoji is an image on the line, and React Native has no inline image inside. */
      return (
        <Image
          source={{ uri: segment.url }}
          accessibilityLabel={`:${segment.shortcode}:`}
          style={s.emoji}
          resizeMode="contain"
        />
      )

    case 'mention': {
      /** A shortened npub as the fallback, NOT the head of the raw bech32. */
      const name = nameFor?.(segment.pubkey)
      return (
        <Link href={profileHref(segment.pubkey, segment.bech32)}>
          <Text style={s.link}>@{name ?? shortNpub(segment.pubkey)}</Text>
        </Link>
      )
    }
    case 'event':
      return (
        /** A reference the host did not draw as a quote card. */
        <Link href={eventHref(segment.id, segment.bech32)}>
          <Text style={s.link}>{segment.bech32.slice(0, 14)}…</Text>
        </Link>
      )
    case 'address': {
      /** A LINK, and named by what it points. */
      const title = addressTitle?.(segment)?.trim()
      const label = title !== undefined && title !== '' ? title : addressLabel(segment)
      if (addressHref === undefined) return <Text style={s.muted}>{label}</Text>
      return (
        <Link href={addressHref(segment.bech32)}>
          <Text style={s.link}>{label}</Text>
        </Link>
      )
    }
    case 'invoice':
      // A host that can pay draws a card.
      return (
        renderInvoice?.(segment.bolt11) ?? <Text style={s.chip}> ⚡ Lightning invoice </Text>
      )
    case 'cashu':
      return <Text style={s.chip}> Cashu token </Text>
    default:
      return null
  }
}

/** Remote image with its own failure state. */
/** How tall and how wide a single image is allowed to get, as width ÷ height. */
const MIN_IMAGE_RATIO = 0.62
const MAX_IMAGE_RATIO = 8

/** Shape to draw before the real one is known. */
const UNKNOWN_IMAGE_RATIO = 1.5

/** One height for every rail cell. */
const RAIL_HEIGHT = 260

/** The width the last rail measured, for the first paint of the next one. */
let lastRailWidth = 0

/** TWO pictures get a taller rail than three or four do. */
const TWO_UP_SHARE = 0.88
const TWO_UP_MAX_HEIGHT = 460

function clampRatio(width: number, height: number): number {
  return Math.min(MAX_IMAGE_RATIO, Math.max(MIN_IMAGE_RATIO, width / height))
}

/** The horizontal image rail, with arrows that say there is more. */
function ImageRail({
  images,
  tags,
  onOpenMedia,
  flush,
  renderVideo,
  renderAudio,
  isAudioOnly,
}: {
  images: { url: string; type?: string }[]
  tags: readonly (readonly string[])[]
  onOpenMedia?: (url: string) => void
  flush: boolean
  /** Supplied by the web host. */
  renderVideo?: (url: string, opts?: { railHeight?: number }) => React.ReactNode
  /** Same escape hatch as `renderVideo`: the web app hands down a real player. */
  renderAudio?: (url: string) => React.ReactNode
  /** Whether a URL that claims to be video is actually sound. */
  isAudioOnly?: (url: string) => boolean
}): React.ReactNode {
  const theme = useTheme()
  const s = styles(theme)
  // `ComponentRef`, not the component type: react-native exports ScrollView.
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null)
  const [offset, setOffset] = useState(0)
  /** Seeded from the last rail that measured itself, not from zero. */
  const [viewport, setViewport] = useState(lastRailWidth)
  const [content, setContent] = useState(0)

  // A pixel of slack either end: fractional scroll offsets are normal, and an arrow.
  const canLeft = offset > 1
  const canRight = content - viewport - offset > 1

  /** ONE frame for the whole post. */
  /** Each picture's own shape, where the note bothered to say. */
  const ratios = images.map(segment => {
    const dim = imetaDimFor(tags, segment.url)
    return dim === undefined ? undefined : dim.width / dim.height
  })
  const preset = galleryPreset(ratios)
  const ratio = MEDIA_PRESET_RATIO[preset]

  /* A PAIR IS NOT A GRID, and does not take the post's single frame. */
  const pair = images.length === 2
  const heightRatio = pair ? (ratios[0] ?? ratio) : ratio
  const cellHeight =
    pair && viewport > 0
      ? Math.min(
          TWO_UP_MAX_HEIGHT,
          Math.max(RAIL_HEIGHT, Math.round((viewport * TWO_UP_SHARE) / heightRatio)),
        )
      : RAIL_HEIGHT
  /** The uniform width, for the grid case. */
  const cellWidth = Math.round(cellHeight * ratio)
  const widthFor = (index: number): number =>
    pair ? Math.round(cellHeight * (ratios[index] ?? ratio)) : cellWidth

  const nudge = (direction: 1 | -1): void => {
    // A little less than a full viewport, so the image at the edge stays partly visible.
    const step = Math.max(1, viewport * 0.8)
    ref.current?.scrollTo({ x: Math.max(0, offset + direction * step), animated: true })
  }

  /* TWO PICTURES USE THE RAIL, like three or four. */

  return (
    <View style={[s.railWrap, flush ? s.mediaFlush : null]}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.railContent}
        scrollEventThrottle={16}
        onScroll={event => setOffset(event.nativeEvent.contentOffset.x)}
        onLayout={event => {
          const width = event.nativeEvent.layout.width
          lastRailWidth = width
          setViewport(width)
        }}
        onContentSizeChange={width => setContent(width)}
      >
        {images.map((segment, index) => (
          <View
            key={index}
            style={[
              s.railItem,
              /* A clip is 16:9 whatever the photographs beside it are shaped. */
              {
                height: cellHeight,
                width: segment.type === 'video' ? Math.round(cellHeight * (16 / 9)) : widthFor(index),
              },
            ]}
          >
            {segment.type === 'video' && renderVideo !== undefined ? (
              renderVideo(segment.url, { railHeight: cellHeight })
            ) : (
              /* `fillHeight` is not optional here now that a pair is taller than the rail's default. */
              <NoteImage
                uri={segment.url}
                tags={tags}
                onOpen={onOpenMedia}
                fill
                fillHeight={cellHeight}
              />
            )}
          </View>
        ))}
      </ScrollView>

      {canLeft ? (
        <Pressable
          onPress={() => nudge(-1)}
          accessibilityRole="button"
          accessibilityLabel="Previous image"
          style={[s.railArrow, s.railArrowLeft]}
        >
          <ChevronIcon direction="left" />
        </Pressable>
      ) : null}

      {canRight ? (
        <Pressable
          onPress={() => nudge(1)}
          accessibilityRole="button"
          accessibilityLabel="More images"
          style={[s.railArrow, s.railArrowRight]}
        >
          <ChevronIcon direction="right" />
        </Pressable>
      ) : null}
    </View>
  )
}

/** The rail's arrow, DRAWN rather than typed. */
function ChevronIcon({ direction }: { direction: 'left' | 'right' }): React.ReactNode {
  const d = direction === 'left' ? 'M14.5 6 8.5 12l6 6' : 'M9.5 6l6 6-6 6'
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" ` +
    `fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" ` +
    `stroke-linejoin="round"><path d="${d}"/></svg>`
  return (
    <SvgImage
      uri={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      style={{ width: 18, height: 18 }}
    />
  )
}

function NoteImage({
  uri,
  tags,
  onOpen,
  fill = false,
  fillHeight = RAIL_HEIGHT,
  flush = false,
}: {
  uri: string
  /** The note's tags, read for a NIP-92 `dim` so the box is right before the image lands. */
  tags?: readonly (readonly string[])[]
  onOpen?: (url: string) => void
  /** Inside a gallery cell, where the surrounding item already sets the width. */
  fill?: boolean
  /** The gallery cell's height in pixels. */
  fillHeight?: number
  /** No text above, so no gap above either. */
  flush?: boolean
}): React.ReactNode {
  const theme = useTheme()
  const s = styles(theme)
  /** Which copy of this blob. */
  const [step, setStep] = useState(0)
  // The author's own servers (BUD-03) ahead of ours.
  const authorServers = useMediaServers()
  const cacheUrl = useMediaCacheUrl()
  /* Everything worth trying, in the order worth trying. */
  const chain = useMemo(() => {
    const mirrors = reorderByHealth([uri, ...blossomAlternatives(uri, [...authorServers, ...DEFAULT_BLOSSOM_SERVERS])])
    const cached = cacheUrl === undefined ? [] : [cacheUrl(uri)]
    const thumb = imetaThumbFor(tags ?? [], uri)
    return [...mirrors, ...cached, ...(thumb === undefined ? [] : [thumb])]
  }, [uri, authorServers, cacheUrl, tags])
  const source = chain[step] ?? uri
  /* The source OBJECT, not just the string. */
  const imageSource = useMemo(() => ({ uri: source }), [source])
  const failed = step >= chain.length
  const setFailed = (): void => {
    noteHostFailure(source)
    setStep(current => current + 1)
  }

  /* A HANG IS A FAILURE, and the browser will not say so for thirty seconds. */
  /* NO STALL TIMER. */

  /* Restart the walk when the PICTURE changes, not when the chain does. */
  useEffect(() => {
    setStep(0)
  }, [uri])

  /** The image's real shape, so it is not cropped to fit a box we picked. */
  const declared = tags === undefined ? undefined : imetaDimFor(tags, uri)
  /** The image's TRUE ratio, unclamped. */
  const [measured, setMeasured] = useState<number | undefined>(
    declared === undefined ? undefined : declared.width / declared.height,
  )

  useEffect(() => {
    if (measured !== undefined || fill) return
    let alive = true
    Image.getSize(
      uri,
      (width, height) => {
        if (alive && width > 0 && height > 0) setMeasured(width / height)
      },
      // A size we cannot read is not an error worth showing: the placeholder shape stands.
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [uri, measured, fill])

  if (failed) {
    /* A PLACEHOLDER, not a sentence. */
    return (
      <Pressable onPress={() => void Linking.openURL(uri)} accessibilityLabel="Image unavailable">
        <View style={fill ? s.missingFill : s.missing}>
          <Text style={s.missingMark}>🖼️</Text>
        </View>
      </Pressable>
    )
  }
  // The frame's shape, and whether it had to differ from the picture's.
  const ratio = measured === undefined ? UNKNOWN_IMAGE_RATIO : clampRatio(measured, 1)

  /** Taller than the frame allows: NARROWED, not pillarboxed. */
  const tall = measured !== undefined && measured < MIN_IMAGE_RATIO
  const narrowed = tall && measured !== undefined
      ? {
          aspectRatio: measured,
          width: `${((measured / MIN_IMAGE_RATIO) * 100).toFixed(2)}%` as DimensionValue,
          alignSelf: 'flex-start' as const,
        }
      : null
  const letterboxed = measured !== undefined && !tall && Math.abs(ratio - measured) > 0.01

  /* Shared with the placeholder, so the row does not resize when the picture arrives. */
  const imageStyle = fill
    ? [s.imageFill, fillHeight === RAIL_HEIGHT ? null : { height: fillHeight }]
    : [s.image, flush ? s.mediaFlush : null, narrowed ?? { aspectRatio: ratio }]

  const image = (
    <Image
      source={imageSource}
      style={imageStyle}
      /** A GALLERY cell always fills. */
      resizeMode={fill ? 'cover' : letterboxed ? 'contain' : 'cover'}
      onError={setFailed}
      onLoad={() => noteHostSuccess(source)}
      accessibilityIgnoresInvertColors
    />
  )
  if (onOpen === undefined) return image
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open image"
      onPress={() => onOpen(uri)}
    >
      {image}
    </Pressable>
  )
}

function shorten(url: string): string {
  const bare = url.replace(/^https?:\/\//, '')
  return bare.length > 48 ? `${bare.slice(0, 48)}…` : bare
}

/** Marks note body text so the web app can size it from CSS. */
const NOTE_BODY_ATTRS = { dataSet: { noteBody: 'true' } } as unknown as Partial<TextProps>

const styles = makeStyles((theme, t) => ({
  // `flexShrink: 1` plus a zero basis is React Native's equivalent of min-width:0.
  body: { color: theme.text, fontSize: 16, lineHeight: 21, flexShrink: 1 },
  // Black like the body, with the weight carrying the distinction instead of a colour.
  /** Everything in a note that can be pressed: links, hashtags, mentions. */
  // Same metrics as the body it sits inside.
  link: { color: theme.link, fontWeight: '600', fontSize: 16, lineHeight: 21 },
  muted: { color: theme.textFaint, fontSize: 13 },
  /* Muted, not the accent. */
  showMore: { color: theme.textMuted, fontSize: 15, marginTop: t.spacing[1] },
  /* The shape a picture would have taken, so a failure costs the note no height. */
  missing: {
    width: '100%',
    aspectRatio: UNKNOWN_IMAGE_RATIO,
    borderRadius: t.radius.md,
    backgroundColor: theme.bgInset,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: t.spacing[2],
  },
  /* Inside a rail cell the height is fixed by the strip, exactly as a real cell's. */
  missingFill: {
    width: '100%',
    height: '100%',
    borderRadius: t.radius.md,
    backgroundColor: theme.bgInset,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingMark: { fontSize: 26, opacity: 0.45 },
  /* 20pt against the 21pt line height these segments use, so a custom emoji sits. */
  emoji: { width: 20, height: 20 },
  chip: {
    color: theme.zapText,
    backgroundColor: theme.zapSurface,
    fontSize: 13,
    borderRadius: t.radius.sm,
  },
  image: {
    width: '100%',
    // No height.
    borderRadius: t.radius.md,
    marginTop: t.spacing[2],
    backgroundColor: theme.bgInset,
  },
  /** The rail thumbnails, which stay square. */
  imageFill: {
    width: '100%',
    /* An explicit height, not `100%`. */
    height: RAIL_HEIGHT,
    borderRadius: t.radius.md,
    backgroundColor: theme.bgInset,
  },
  rail: {
    marginTop: t.spacing[2],
  },
  /** Positioned, so the arrows can sit over the rail rather than beside. */
  railWrap: {
    marginTop: t.spacing[2],
    position: 'relative',
  },
  /** A dark disc, not a themed surface. */
  railArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  railArrowLeft: {
    left: t.spacing[2],
  },
  railArrowRight: {
    right: t.spacing[2],
  },
  /* No `railArrowGlyph` any more. */
  /** Kills the gap under a body that is not there. */
  mediaFlush: {
    marginTop: 0,
  },
  /** One track under another: the same rhythm the rail uses between its cells. */
  sound: {
    marginTop: t.spacing[2],
  },
  railContent: {
    gap: t.spacing[2],
  },
  /** One height per POST. */
  /* Height is set per cell by the rail. */
  railItem: {
    height: RAIL_HEIGHT,
  },
}))
