'use client'

import { Link } from './AppLink'
import { Avatar } from './Avatar'
import { profileDisplayName, type Hex } from '@nostrich/nostr'
import { useRef } from 'react'
import { useZaps, zapsFor, zapsSettled } from '../lib/zap-store'
import { PATHS } from '@nostrich/app'
import { useProfile } from '../lib/profiles'
import { profileHref } from '../lib/links'
import type { ZapDetail } from '../lib/interactions'

/** Who zapped this note, above the action row. */

/** Faces on the right. */
const RECENT_FACES = 3

function ZapperFace({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const profile = useProfile(pubkey)
  const name = profileDisplayName({ ...profile, pubkey })
  return (
    <Link
      href={profileHref(pubkey)}
      onClick={event => event.stopPropagation()}
      title={name}
      aria-label={`${name} zapped this`}
      className="-ml-1.5 rounded-full ring-2 ring-bg transition-transform first:ml-0 hover:z-10 hover:scale-110"
    >
      <Avatar pubkey={pubkey} name={name} picture={profile?.picture} size="xs" />
    </Link>
  )
}

function TopZap({ zap }: { zap: ZapDetail }): React.ReactNode {
  const profile = useProfile(zap.sender)
  const name = profileDisplayName({ ...profile, pubkey: zap.sender })

  return (
    <Link
      href={profileHref(zap.sender)}
      onClick={event => event.stopPropagation()}
      title={`${name} zapped ${zap.sats.toLocaleString()} sats`}
      /* A pill, because the amount and the comment are one statement by one person. */
      className="flex min-w-0 max-w-[70%] items-center gap-1.5 rounded-full bg-bg-chip py-1 pl-1 pr-2.5 transition-colors hover:bg-border"
    >
      <Avatar pubkey={zap.sender} name={name} picture={profile?.picture} size="xs" />
      {/* The app's own bolt, the one the action row draws. */}
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-[19px] shrink-0 fill-zap-icon"
      >
        <path d={PATHS.zap} />
      </svg>
      <span className="shrink-0 text-[14px] font-bold tabular-nums text-text">
        {zap.sats.toLocaleString()}
      </span>
      {/* The comment is the zapper's, so it is truncated rather than wrapped: this strip. */}
      {zap.comment !== undefined ? (
        <span className="truncate text-[14px] text-text-muted">{zap.comment}</span>
      ) : null}
    </Link>
  )
}

export function ZapStrip({
  zaps,
  noteId,
}: {
  zaps: readonly ZapDetail[]
  /** The note these zaps are on, so this strip can pool what it was handed. */
  noteId?: string
}): React.ReactNode {
  /** Was this note's answer already on disk when the page opened. */
  const known = useRef<boolean | undefined>(undefined)
  if (known.current === undefined) known.current = (zapsFor(noteId)?.length ?? 0) > 0

  const pooled = useZaps(noteId, zaps)
  if (pooled.length === 0) return null
  /* Nothing at all until the answer. */
  /* A zap the READER just made always shows, settled. */
  const mine = pooled.some(zap => zap.pending === true)
  if (!mine && known.current !== true && !zapsSettled(noteId)) return null

  // Biggest on the left.
  const top = [...pooled].sort((a, b) => b.sats - a.sats || a.at - b.at)[0]
  if (top === undefined) return null

  /* The faces exclude whoever is already shown on the left. */
  const faces: Hex[] = []
  for (const zap of pooled) {
    if (zap.sender === top.sender || faces.includes(zap.sender)) continue
    faces.push(zap.sender)
    if (faces.length >= RECENT_FACES) break
  }

  return (
    <div className="mb-1.5 mt-[15px] flex items-center justify-between gap-3">
      <TopZap zap={top} />
      {faces.length > 0 ? (
        <div className="flex shrink-0 items-center pr-1">
          {faces.map(pubkey => (
            <ZapperFace key={pubkey} pubkey={pubkey} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
