'use client'

import { profileDisplayName, type NostrEvent } from '@nostrich/nostr'

import { useMemo } from 'react'

import { Link } from './AppLink'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { relativeTimeShort } from '../lib/format'
import { Avatar } from './Avatar'
import { VerifiedBadge } from './VerifiedBadge'
import { useNowSeconds } from './Clock'
import { QuotedBody } from './QuotedNote'
import { quotedPieces } from '../lib/quoted-pieces'
import { mediaOnlyLabel } from '../lib/media-only'

/** The rail's note row, shared by every panel. */

/** One row: avatar, author, then the opening of the note. */
function TrendingRow({
  event,
  showName = true,
}: {
  event: NostrEvent | undefined
  /** False on a panel where every row is the same person. */
  showName?: boolean
}): React.ReactNode {
  const profile = useProfile(event?.pubkey)
  // One parse per note rather than one per render: these panels repaint on every clock.
  const pieces = useMemo(() => (event === undefined ? [] : quotedPieces(event)), [event])
  /* What to say when the note turns out to have no words. */
  const mediaLabel = useMemo(
    () => (event === undefined ? null : mediaOnlyLabel(event, pieces)),
    [event, pieces],
  )
  // Zero until the shared clock starts, which is what keeps the server render.
  const now = useNowSeconds()

  if (event === undefined) {
    return (
      <>
        <span className="size-8 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
        <span className="h-4 flex-1 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
      </>
    )
  }

  const name = profileDisplayName({ ...profile, pubkey: event.pubkey })
  const verified = useNip05Verified(profile?.nip05, event.pubkey)
  return (
    <>
      {/* NO HOVER CARD HERE, unlike the timeline's avatars. */}
      <Avatar pubkey={event.pubkey} name={name} picture={profile?.picture} size="sm" />
      <span className="min-w-0 flex-1">
        {/* The tick, same as every other name in the app. */}
        {showName ? (
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-sm font-semibold text-text">{name}</span>
            {verified ? <VerifiedBadge size={13} /> : null}
          </span>
        ) : null}
        {/* NOT `event.content`. */}
        <span className="line-clamp-2 text-xs leading-snug text-text-muted">
          {/* A NOTE THAT IS ONLY A PICTURE still has to say something here. */}
          {mediaLabel === null ? (
            <QuotedBody pieces={pieces} inert />
          ) : (
            <span className="text-text-faint">[{mediaLabel}]</span>
          )}
        </span>
      </span>
      {/* THE AGE IS ITS OWN COLUMN, right-aligned, not a suffix on the name. */}
      {/* `min-w-9` and no wrapping, not a fixed `w-9`. */}
      <span className="min-w-9 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-text-faint">
        {now === 0 ? '' : relativeTimeShort(event.created_at, now)}
      </span>
    </>
  )
}

export function TrendingRows({
  rows,
  showName = true,
}: {
  rows: readonly NostrEvent[]
  showName?: boolean
}): React.ReactNode {
  return (
    <ul className="mt-2">
      {rows.map(event => (
        <li key={event.id}>
          <Link
            href={`/e/${event.id}`}
            /* `items-center`: the avatar and the age line up against the WHOLE row. */
            className="flex items-center gap-2.5 px-5 py-2.5 transition-colors hover:bg-bg-inset"
          >
            <TrendingRow event={event} showName={showName} />
          </Link>
        </li>
      ))}
    </ul>
  )
}
