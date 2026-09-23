'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { profileDisplayName, profileHandle, shortNpub, type Hex } from '@nostrich/nostr'

import { npubOf } from '../lib/format'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { useFollows } from '../lib/contacts'
import { useTrending } from '../lib/trending'
import { orderSuggestions, reconcileSuggestions, SUGGESTIONS_SHOWN } from '../lib/who-to-follow'
import { Link } from './AppLink'
import { Avatar } from './Avatar'
import { useNowSeconds } from './Clock'
import { FollowButton } from './FollowButton'
import { sessionPubkey, useSession } from './SessionProvider'
import { VerifiedBadge } from './VerifiedBadge'

/** The window the suggestions come. */
/** The windows, in preference order. */
const WINDOWS = [4, 1, 24] as const
/** Five accounts to follow, drawn from the people whose notes are trending. */
export function WhoToFollow(): React.ReactNode {
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const follows = useFollows(viewer)
  const following = useMemo(() => new Set(follows.all), [follows.all])
  /* The hour bucket, from the app's shared clock. */
  const hour = Math.floor(useNowSeconds() / 3600)

  /* THE LATER WINDOWS ARE NOT FETCHED UNLESS THEY ARE NEEDED. */
  const four = useTrending(WINDOWS[0], true)
  const fourPool = usePool([four.entries], viewer, hour)

  const one = useTrending(WINDOWS[1], available(fourPool, following) < SUGGESTIONS_SHOWN)
  const twoPool = usePool([four.entries, one.entries], viewer, hour)

  const day = useTrending(WINDOWS[2], available(twoPool, following) < SUGGESTIONS_SHOWN)
  const pool = usePool([four.entries, one.entries, day.entries], viewer, hour)

  /** THE FIVE ON SCREEN, held rather than derived. */
  const [shown, setShown] = useState<Hex[]>([])
  const hourRef = useRef(hour)
  useEffect(() => {
    const fresh = hourRef.current !== hour
    hourRef.current = hour
    setShown(previous => {
      const next = reconcileSuggestions(fresh ? [] : previous, pool, following)
      // Same five, same order: return the old array so nothing below re-renders.
      return next.length === previous.length && next.every((p, i) => p === previous[i])
        ? previous
        : next
    })
  }, [pool, following, hour])

  const picks = shown

  /* NOTHING AT ALL when there is nobody to suggest. */
  if (picks.length === 0) return null

  return (
    <section
      aria-labelledby="who-to-follow-heading"
      className="mb-3 mr-3 rounded-lg border border-border bg-bg-elevated py-5"
    >
      <h2 id="who-to-follow-heading" className="px-5 text-xl font-bold text-text">
        Who to follow
      </h2>
      <ul className="mt-3">
        {picks.map(pubkey => (
          <Suggestion key={pubkey} pubkey={pubkey} />
        ))}
      </ul>
    </section>
  )
}

/** Authors out of a set of windows, run through `pickSuggestions`. */
function usePool(
  windows: readonly { note?: { pubkey: Hex } }[][],
  viewer: Hex | undefined,
  hour: number,
): Hex[] {
  const authors = windows.map(entries =>
    entries.flatMap(entry => (entry.note === undefined ? [] : [entry.note.pubkey])),
  )
  const key = authors.map(tier => tier.join(',')).join('|')
  return useMemo(
    () => orderSuggestions(authors, viewer, hour),
    // Keyed on the author lists by VALUE: every call site builds a fresh array literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, viewer, hour],
  )
}

/** How many of a pool the reader could actually be shown. */
function available(pool: readonly Hex[], following: ReadonlySet<string>): number {
  let count = 0
  for (const person of pool) if (!following.has(person)) count += 1
  return count
}

function Suggestion({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const profile = useProfile(pubkey)
  const verified = useNip05Verified(profile?.nip05, pubkey)
  const name = profileDisplayName(profile ?? { pubkey })
  const chosen = profileHandle(profile)
  const handle = chosen === undefined ? shortNpub(pubkey) : `@${chosen}`

  return (
    <li>
      {/* The row is a link and the button is not inside. */}
      <div className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-bg-inset">
        <Link href={`/p/${npubOf(pubkey)}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar pubkey={pubkey} name={name} picture={profile?.picture} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate text-[15px] font-bold text-text">{name}</span>
              {verified ? <VerifiedBadge size={15} /> : null}
            </span>
            <span className="block truncate text-sm text-text-muted">{handle}</span>
          </span>
        </Link>
        <FollowButton target={pubkey} />
      </div>
    </li>
  )
}
