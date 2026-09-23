'use client'

import {
  liveEventAt,
  parseLiveEvent,
  profileDisplayName,
  profileHandle,
  type LiveStatus,
  type NostrEvent,
} from '@nostrich/nostr'

import { useAddressEvent, type AddressPointer } from '../lib/addresses'
import { compactCount, relativeTime } from '../lib/format'
import { entityHref } from '../lib/links'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { useBlossomSrc } from '../lib/blossom-retry'
import { Avatar } from './Avatar'
import { ContentLink } from './ContentLink'
import { useNowSeconds } from './Clock'
import { VerifiedBadge } from './VerifiedBadge'

/** A LIVE STREAM, DRAWN AS A CARD. */

/** Neutral while the pointer resolves. */
function Skeleton(): React.ReactNode {
  return (
    <span className="mt-3 block animate-pulse rounded-2xl border border-border px-4 py-3">
      <span className="flex items-center gap-2">
        <span className="size-8 shrink-0 rounded-full bg-bg-inset" />
        <span className="h-3 w-24 rounded bg-bg-inset" />
      </span>
      <span className="mt-2.5 block h-4 w-3/4 rounded bg-bg-inset" />
      <span className="mt-2 block h-3 w-28 rounded bg-bg-inset" />
    </span>
  )
}

/** The red dot that means "happening now". */
function LiveBadge({ onImage = false }: { onImage?: boolean }): React.ReactNode {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        onImage ? 'bg-black/70 text-white backdrop-blur-sm' : 'bg-danger/10 text-danger'
      }`}
    >
      {/* The pulse is the only moving thing on the card, and it is the one fact that changes. */}
      <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden="true" />
      Live
    </span>
  )
}

/** What the status line says, in the reader's terms rather than the protocol's. */
function statusText(status: LiveStatus, at: number, now: number): string {
  const ago = relativeTime(at, now)
  switch (status) {
    case 'live':
      return `Started ${ago} ago`
    case 'planned':
      // `starts` is in the FUTURE here, so "ago" would be nonsense.
      return 'Scheduled'
    case 'ended':
      return `Stream ended ${ago} ago`
    default:
      /* No `status` tag. */
      return ago === '' ? 'Live stream' : `${ago} ago`
  }
}

function Cover({ url, alt, host }: { url: string; alt: string; host: string }): React.ReactNode {
  /* Same retry walk every avatar and note image uses: a dead Blossom host is not a dead. */
  const { src, fail, onLoad, exhausted } = useBlossomSrc(url, host as never)
  /* `exhausted`, not `fail`: `fail` is the error HANDLER that advances to the next. */
  if (src === undefined || exhausted) return null
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={fail}
      onLoad={onLoad}
      className="aspect-video w-full bg-bg-inset object-cover"
    />
  )
}

/** Resolves an `naddr` and draws. */
export function StreamCard({ pointer }: { pointer: AddressPointer }): React.ReactNode {
  const { event, loading } = useAddressEvent(pointer)

  if (loading && event === undefined) return <Skeleton />
  /* NOTHING RATHER THAN A BROKEN CARD. */
  if (event === undefined) return null
  return <StreamCardView event={event} href={entityHref(pointer.bech32)} />
}

/** The card itself, from an event somebody else already resolved. */
export function StreamCardView({
  event,
  href,
}: {
  event: NostrEvent
  /** Where the card points. */
  href: string
}): React.ReactNode {
  const now = useNowSeconds()
  const live = parseLiveEvent(event)
  const host = live.host
  const profile = useProfile(host)
  const verified = useNip05Verified(profile?.nip05, host)

  const name = profileDisplayName(profile ?? { pubkey: host })
  const handle = profileHandle(profile)
  const title = live.title ?? 'Live stream'
  const at = liveEventAt(live, event)
  const watching = live.currentParticipants
  const isLive = live.status === 'live'

  return (
    <ContentLink
      href={href}
      className="mt-3 block overflow-hidden rounded-2xl border border-border transition-colors hover:bg-bg-inset"
    >
      {live.image === undefined ? null : (
        <span className="relative block">
          <Cover url={live.image} alt={title} host={host} />
          {isLive ? (
            <span className="absolute left-2 top-2">
              <LiveBadge onImage />
            </span>
          ) : null}
          {watching === undefined ? null : (
            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
              <span className="material-symbols-outlined text-[13px]!" aria-hidden="true">
                person
              </span>
              {compactCount(watching)}
            </span>
          )}
        </span>
      )}

      <span className="block px-4 py-3">
        {/* The HOST's face and name, not the publishing platform's. */}
        <span className="flex min-w-0 items-center gap-2">
          <Avatar pubkey={host} name={name} picture={profile?.picture} size="sm" />
          <span className="min-w-0 truncate font-semibold text-text">{name}</span>
          {verified ? <VerifiedBadge size={14} /> : null}
          {handle === undefined ? null : (
            <span className="min-w-0 truncate text-sm text-text-muted">{handle}</span>
          )}
        </span>

        {/* Two lines at most: a stream title is a sentence somebody typed, occasionally. */}
        {/* No `block`: `line-clamp-2` sets `display:-webkit-box` and a display utility beside. */}
        <span className="mt-2 line-clamp-2 font-semibold leading-snug text-text">{title}</span>

        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-faint">
          {/* Inline only when there is no cover to sit on, so it is never said twice. */}
          {isLive && live.image === undefined ? <LiveBadge /> : null}
          <span>{statusText(live.status, at, now)}</span>
          {watching === undefined || live.image !== undefined ? null : (
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]!" aria-hidden="true">
                person
              </span>
              {compactCount(watching)}
            </span>
          )}
        </span>
      </span>
    </ContentLink>
  )
}
