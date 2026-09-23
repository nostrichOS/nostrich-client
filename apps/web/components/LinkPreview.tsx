'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { videoEmbed } from '@nostrich/nostr'

import { ContentLink } from './ContentLink'

/** The Open Graph card under a note whose only content is a link. */

/** YouTube's own play button, to the pixel. */
function YouTubePlayButton(): React.ReactNode {
  return (
    <svg
      viewBox="0 0 68 48"
      width={68}
      height={48}
      aria-hidden="true"
      className="opacity-80 drop-shadow-lg transition-opacity group-hover:opacity-100"
    >
      <path
        d="M66.52,7.74c-0.78-2.93-2.49-5.41-5.42-6.19C55.79,0.13,34,0,34,0S12.21,0.13,6.9,1.55 C3.97,2.33,2.27,4.81,1.48,7.74C0.06,13.05,0,24,0,24s0.06,10.95,1.48,16.26c0.78,2.93,2.49,5.41,5.42,6.19 C12.21,47.87,34,48,34,48s21.79-0.13,27.1-1.55c2.93-0.78,4.64-3.26,5.42-6.19C67.94,34.95,68,24,68,24S67.94,13.05,66.52,7.74z"
        fill="#f00"
      />
      <path d="M 45,24 27,14 27,34" fill="#fff" />
    </svg>
  )
}

/** The video still: a real play button normally, a plain frame when a link already. */
function PosterFrame({
  inert,
  label,
  onPlay,
  audio = false,
  audioHeight = 152,
  children,
}: {
  inert: boolean
  label: string
  onPlay: () => void
  /** A short bar rather than a 16:9 frame. */
  audio?: boolean
  /** Providers disagree: Spotify and SoundCloud are 152, Apple's compact player is 175. */
  audioHeight?: number
  children: React.ReactNode
}): React.ReactNode {
  /* AUDIO IS A BAR, NOT A FRAME. */
  const className = `group relative block ${audio ? '' : 'aspect-video'} w-full cursor-pointer bg-bg-inset`
  /* The height is inline rather than a class because it VARIES BY PROVIDER. */
  const shape = audio ? { height: audioHeight } : undefined
  const play = (): void => onPlay()

  /* INSIDE A QUOTE, WHERE A BUTTON CANNOT GO. */
  if (inert) {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={label}
        {...(shape === undefined ? {} : { style: shape })}
        onClick={clickEvent => {
          clickEvent.preventDefault()
          clickEvent.stopPropagation()
          play()
        }}
        onKeyDown={keyEvent => {
          if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return
          keyEvent.preventDefault()
          keyEvent.stopPropagation()
          play()
        }}
        className={`${className} pointer-events-auto`}
      >
        {children}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={clickEvent => {
        // The note card underneath is clickable.
        clickEvent.stopPropagation()
        play()
      }}
      aria-label={label}
      className={className}
      {...(shape === undefined ? {} : { style: shape })}
    >
      {children}
    </button>
  )
}

/** For providers with no button of their own worth imitating. */
function GenericPlayButton(): React.ReactNode {
  return (
    <span className="flex size-16 items-center justify-center rounded-full bg-black/65 backdrop-blur-sm transition-transform group-hover:scale-105">
      <svg viewBox="0 0 24 24" width={26} height={26} aria-hidden="true" fill="#fff">
        <path d="M8 5.14v13.72L19 12 8 5.14z" />
      </svg>
    </span>
  )
}

/** Bumped to abandon everything the caches are still holding. */
const UNFURL_VERSION = 3

/** One fetch for both callers, and the reason it is not two lines inline. */
async function fetchUnfurl(url: string): Promise<Unfurled> {
  const response = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}&v=${UNFURL_VERSION}`)
  if (response.status === 503) throw new Error('unfurl is temporarily unavailable')
  if (!response.ok) return { url }
  return (await response.json()) as Unfurled
}

interface Unfurled {
  url: string
  title?: string
  description?: string
  /** Ours, through `/api/og-image`. */
  image?: string
  /** The publisher's own URL. */
  imageDirect?: string
  siteName?: string
}

/** Whether a link will draw a card, for a caller that needs to know before it renders. */
/** The frame: a real link normally, a plain span when something above is already. */
function PreviewFrame({
  inert,
  href,
  className,
  children,
}: {
  inert: boolean
  href: string
  className: string
  children: React.ReactNode
}): React.ReactNode {
  if (inert) return <span className={className}>{children}</span>
  return (
    <ContentLink
      href={href}
      // The note card is itself clickable.
      onClick={event => event.stopPropagation()}
      className={className}
    >
      {children}
    </ContentLink>
  )
}

export function useUnfurl(url: string | undefined): boolean {
  const query = useQuery({
    queryKey: ['unfurl', url ?? ''],
    queryFn: async (): Promise<Unfurled> => fetchUnfurl(url ?? ''),
    enabled: url !== undefined,
    staleTime: 6 * 60 * 60_000,
    gcTime: 12 * 60 * 60_000,
    // Only a 503 ever throws, and that is precisely the case worth asking again.
    retry: 2,
  })
  if (url === undefined) return false
  // A video card draws on the provider's own poster and needs no unfurl at all.
  if (videoEmbed(url) !== undefined) return true
  const data = query.data
  return data !== undefined && (data.title !== undefined || data.image !== undefined)
}

export function LinkPreview({
  url,
  inert = false,
}: {
  url: string
  /** Rendered inside something that is ALREADY a link. */
  inert?: boolean
}): React.ReactNode {
  const embed = useMemo(() => videoEmbed(url), [url])
  /** The player is built on press, never. */
  const [playing, setPlaying] = useState(false)

  /** The image URL that failed to load, if one. */
  /** Images that have already failed for this card, in order of preference. */
  const [failedImages, setFailedImages] = useState<string[]>([])

  const query = useQuery({
    queryKey: ['unfurl', url],
    queryFn: async (): Promise<Unfurled> => fetchUnfurl(url),
    // The metadata behind a link does not move on the timescale of a timeline, and a feed.
    staleTime: 6 * 60 * 60_000,
    gcTime: 12 * 60 * 60_000,
    /* A site that would not answer will not answer three more times. */
    retry: 2,
  })

  const data = query.data

  /** A video card can render on the poster alone. */
  /** The frame: a real link normally, a plain span when something above is already. */
  /* Hoisted to module scope. */
  const frameHref = data?.url ?? url

  if (embed !== undefined) {
    const poster = [embed.poster, data?.image, data?.imageDirect].find(
      candidate => candidate !== undefined && !failedImages.includes(candidate),
    )
    return (
      <span className="mt-3 block overflow-hidden rounded-xl border border-border">
        {playing ? (
          <iframe
            src={embed.embedUrl}
            title={data?.title ?? 'Video'}
            // `allow` without `autoplay` means the press does nothing and the reader has to click.
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            // `pointer-events-auto` for the same reason the poster needs it: inside a quote.
            className={`w-full border-0 bg-black pointer-events-auto ${
              embed.kind === 'audio' ? '' : 'aspect-video'
            }`}
            {...(embed.kind === 'audio'
              ? { style: { height: embed.height ?? 152 } }
              : {})}
          />
        ) : (
          /* Inert: the poster, and no player. */
          <PosterFrame
            inert={inert}
            audio={embed.kind === 'audio'}
            audioHeight={embed.height ?? 152}
            label={data?.title === undefined ? 'Play' : `Play: ${data.title}`}
            onPlay={() => setPlaying(true)}
          >
            {poster === undefined ? null : (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
              <img
                src={poster}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setFailedImages(current => [...current, poster])}
                className="size-full object-cover"
              />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              {embed.provider === 'youtube' ? <YouTubePlayButton /> : <GenericPlayButton />}
            </span>
          </PosterFrame>
        )}
        {/* Under the video. */}
        {data?.title === undefined || playing ? null : (
          <PreviewFrame
            inert={inert}
            href={frameHref}
            className={`block px-3.5 py-3${inert ? '' : ' transition-colors hover:bg-bg-inset'}`}
          >
            <span className="line-clamp-2 font-semibold text-text">{data.title}</span>
            <span className="mt-0.5 block text-xs text-text-faint">
              {data.description === undefined
                ? (data.siteName ?? embed.provider)
                : `${data.siteName ?? embed.provider} · ${data.description}`}
            </span>
          </PreviewFrame>
        )}
      </span>
    )
  }
  /** Nothing at all while it is unknown, and nothing when there is nothing to show. */
  // An image that failed counts as no image, including for the question.
  const image = [data?.image, data?.imageDirect].find(
    candidate => candidate !== undefined && !failedImages.includes(candidate),
  )
  if (data === undefined || (data.title === undefined && image === undefined)) return null

  let host = ''
  try {
    host = new URL(data.url).hostname.replace(/^www\./, '')
  } catch {
    host = ''
  }

  /* THE IMAGE IS THE CARD, when there is one. */
  if (image !== undefined) {
    return (
      <span className="mt-3 block">
        <PreviewFrame
          inert={inert}
          href={frameHref}
          className="relative block overflow-hidden rounded-xl border border-border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host. */}
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            // Fetched by the reader from a stranger's server.
            referrerPolicy="no-referrer"
            // Records THIS url as failed, which promotes the next candidate on the re-render.
            onError={() => setFailedImages(current => [...current, image])}
            className="aspect-[1.91/1] w-full bg-bg-inset object-cover"
          />
          {data.title === undefined ? null : (
            /* Inset from the corner rather than flush to it: the chip is a label. */
            <span className="absolute bottom-3 left-3 right-3 flex">
              {/* ONE LINE, and it ends in an ellipsis rather than wrapping. */}
              <span className="min-w-0 truncate rounded-[4px] bg-[#0f1419] px-2 py-1 text-[13px] font-normal text-white">
                {data.title}
              </span>
            </span>
          )}
        </PreviewFrame>
        {host === '' ? null : (
          <PreviewFrame
            inert={inert}
            href={frameHref}
            className={`mt-1.5 block text-sm text-text-muted${inert ? '' : ' hover:underline'}`}
          >
            {/* THE DOMAIN, not the site's own name for itself. */}
            From {host}
          </PreviewFrame>
        )}
      </span>
    )
  }

  /* No picture: the card is the words, so it keeps a frame. */
  return (
    <PreviewFrame
      inert={inert}
      href={frameHref}
      className={`mt-3 block overflow-hidden rounded-xl border border-border px-3.5 py-3${
        inert ? '' : ' transition-colors hover:bg-bg-inset'
      }`}
    >
      {host === '' ? null : (
        /* The domain here too. */
        <span className="block text-xs uppercase tracking-wide text-text-faint">{host}</span>
      )}
      {data.title === undefined ? null : (
        <span className="mt-0.5 line-clamp-2 font-semibold text-text">{data.title}</span>
      )}
      {data.description === undefined ? null : (
        <span className="mt-1 line-clamp-2 text-sm text-text-muted">{data.description}</span>
      )}
    </PreviewFrame>
  )
}
