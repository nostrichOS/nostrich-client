'use client'

import { Link } from './AppLink'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { touchPrimary } from '../lib/pointer'
import { anchorVisible, placeBelow, type Placement } from '../lib/anchored'
import {
  profileDisplayName,
  profileHandle,
  type Hex,
} from '@nostrich/nostr'

import { useFollowsYou } from '../lib/contacts'
import { npubOf } from '../lib/format'
import { profileHref } from '../lib/links'
import { useProfileTotals } from '../lib/profile-totals'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { Avatar } from './Avatar'
import { FollowButton } from './FollowButton'
import { FollowedBy } from './FollowedBy'
import { FollowsDialog } from './FollowsDialog'
import { NoteContent } from './NoteContent'
import { sessionPubkey, useSession } from './SessionProvider'
import { VerifiedBadge } from './VerifiedBadge'

/** Everything you would open a profile to check, without opening. */

/** Long enough that brushing past an avatar on the way somewhere does not summon a card. */
const OPEN_DELAY_MS = 350
/** And a grace period on the way out. */
const CLOSE_DELAY_MS = 200

const CARD_WIDTH = 320

/** Whether the primary input is a FINGER, which is not the same question as how wide. */
/** The AVATAR's viewport rect, not the wrapper's. */
function anchorRect(wrapper: HTMLElement | null): DOMRect | null {
  if (wrapper === null || !wrapper.isConnected) return null
  const target = wrapper.firstElementChild ?? wrapper
  return target.getBoundingClientRect()
}

export function ProfileHoverCard({
  pubkey,
  children,
  inline = false,
}: {
  pubkey: Hex
  children: React.ReactNode
  /** Set when the anchor is a word inside a sentence rather than an avatar beside one. */
  inline?: boolean
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  const { session } = useSession()
  /* NOT OVER YOUR OWN FACE. */
  const isSelf = sessionPubkey(session) === pubkey
  /** The COMPUTED placement, not the raw rect. */
  const [at, setAt] = useState<Placement | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = (): void => {
    if (openTimer.current !== null) clearTimeout(openTimer.current)
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    openTimer.current = null
    closeTimer.current = null
  }

  const scheduleOpen = (): void => {
    // Nothing opens on a touch device.
    if (touchPrimary()) return
    clear()
    openTimer.current = setTimeout(() => {
      const wrapper = anchorRef.current
      if (wrapper === null) return
      const rect = anchorRect(wrapper)
      if (rect === null) return
      setAt(placeBelow(rect, CARD_WIDTH, window.innerWidth, window.innerHeight))
      setOpen(true)
    }, OPEN_DELAY_MS)
  }

  /** Re-anchor from a fresh measurement. */
  const place = useCallback((): void => {
    const card = cardRef.current
    if (card === null) return
    const rect = anchorRect(anchorRef.current)
    // The avatar has left the screen, or its row was replaced.
    if (rect === null || !anchorVisible(rect, window.innerWidth, window.innerHeight)) {
      setOpen(false)
      return
    }
    const next = placeBelow(rect, CARD_WIDTH, window.innerWidth, window.innerHeight)
    card.style.left = `${next.left}px`
    card.style.top = `${next.top}px`
    card.style.maxHeight = `${next.maxHeight}px`
  }, [])

  /** Follow the anchor while the card is open. */
  useEffect(() => {
    if (!open) return
    let frame = 0
    const onViewportChange = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        place()
      })
    }
    window.addEventListener('scroll', onViewportChange, { passive: true, capture: true })
    window.addEventListener('resize', onViewportChange, { passive: true })
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      // `capture: true` has to be repeated here, or the listener is never removed.
      window.removeEventListener('scroll', onViewportChange, { capture: true })
      window.removeEventListener('resize', onViewportChange)
    }
  }, [open, place])

  // A row unmounting inside the open delay would otherwise leave a live timer behind.
  useEffect(() => clear, [])

  const scheduleClose = (): void => {
    clear()
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }

  return (
    <span
      ref={anchorRef}
      // `self-start` so this hugs the avatar instead of stretching down the note.
      className={inline ? 'inline' : 'inline-block self-start'}
      onMouseEnter={isSelf ? undefined : scheduleOpen}
      onMouseLeave={isSelf ? undefined : scheduleClose}
    >
      {children}
      {open && at !== null && typeof document !== 'undefined'
        ? createPortal(
            <div
              /* Kept alive while the pointer is over the card itself, which is what makes. */
              onMouseEnter={clear}
              onMouseLeave={scheduleClose}
              onClick={event => event.stopPropagation()}
              ref={cardRef}
              /* The FIRST paint only. */
              style={{ left: at.left, top: at.top, maxHeight: at.maxHeight, width: CARD_WIDTH }}
              className="no-scrollbar fixed z-[100] cursor-default overflow-y-auto rounded-2xl border border-border bg-bg-elevated p-4 shadow-lg"
            >
              <HoverBody pubkey={pubkey} />
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

function HoverBody({ pubkey }: { pubkey: Hex }): React.ReactNode {
  /** Which list the reader asked for, when they press one of the counts below. */
  const [connections, setConnections] = useState<'following' | 'followers' | null>(null)
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const profile = useProfile(pubkey)
  const verified = useNip05Verified(profile?.nip05, pubkey)
  /* The SAME resolution the profile header uses. */
  const totals = useProfileTotals(pubkey)
  const followsYou = useFollowsYou(pubkey, viewer)

  const name = profileDisplayName(profile ?? { pubkey })
  const handle = profileHandle(profile)
  const npub = npubOf(pubkey)

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <Link href={profileHref(npub)}>
          <Avatar pubkey={pubkey} name={name} picture={profile?.picture} size="xl" />
        </Link>
        {/* Top right, where every social app puts it and where the pointer already. */}
        <FollowButton target={pubkey} />
      </div>

      <div className="mt-2">
        <Link href={profileHref(npub)} className="flex min-w-0 items-center gap-1">
          <span className="truncate text-lg font-bold leading-tight text-text">{name}</span>
          {verified ? <VerifiedBadge size={17} mine={pubkey === viewer} /> : null}
        </Link>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <span className="truncate text-sm text-text-muted">
            @{handle ?? npub.slice(5, 13)}
          </span>
          {/* Reciprocity is the single most useful fact on this card after the name: it turns. */}
          {followsYou === true ? (
            <span className="shrink-0 rounded-sm bg-bg-inset px-1.5 py-0.5 text-xs text-text-muted">
              Follows you
            </span>
          ) : null}
        </div>
      </div>

      {profile?.about !== undefined && profile.about !== '' ? (
        /* Through the note parser, so hashtags and links in a bio behave here exactly. */
        <div className="mt-2 line-clamp-4 text-sm leading-relaxed text-text">
          <NoteContent
            event={{
              id: '',
              pubkey,
              created_at: 0,
              kind: 0,
              tags: [],
              content: profile.about,
              sig: '',
            }}
            hideMedia
          />
        </div>
      ) : null}

      {/* THE COUNTS OPEN THE LIST, as they do on the profile itself. */}
      {/* THE ROW IS ALWAYS THERE. */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
        {!totals.followingReady ? (
          <span className="inline-block h-5 w-24 animate-pulse rounded bg-bg-inset align-middle motion-reduce:animate-none" />
        ) : (
          <button
            type="button"
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              setConnections('following')
            }}
            className="cursor-pointer hover:underline"
          >
            <strong className="text-text">{totals.following.toLocaleString()}</strong> Following
          </button>
        )}
        {!totals.followersReady ? (
          <span className="inline-block h-5 w-24 animate-pulse rounded bg-bg-inset align-middle motion-reduce:animate-none" />
        ) : (
          <button
            type="button"
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              setConnections('followers')
            }}
            className="cursor-pointer hover:underline"
          >
            <strong className="text-text">
              {totals.followers.toLocaleString()}
              {totals.followersCapped ? '+' : ''}
            </strong>{' '}
            Followers
          </button>
        )}
      </div>

      {connections === null ? null : (
        <FollowsDialog
          pubkey={pubkey}
          initialTab={connections}
          followingTotal={totals.following}
          followersTotal={totals.followers}
          onClose={() => setConnections(null)}
        />
      )}

      {/* The same component the profile header uses, so the two can never say different. */}
      {/* Reads the graph, never builds. */}
      <FollowedBy pubkey={pubkey} viewer={viewer} eager={false} />
    </>
  )
}
