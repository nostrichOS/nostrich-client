'use client'

import { Link } from './AppLink'
import { useMemo } from 'react'
import { profileDisplayName, type Hex } from '@nostrich/nostr'

import { npubOf } from '../lib/format'
import { profileHref } from '../lib/links'
import { useProfile } from '../lib/profiles'
import { useSocialGraph } from '../lib/social-graph'
import { Avatar } from './Avatar'

/** "Followed by Gigi, Derek Ross, and HODL." The only social proof on a profile. */

/** Three faces. It is a glance, not a list. */
const FACES = 3
/** Three names, matching the three faces above them. */
const NAMED = 3

export function FollowedBy({
  pubkey,
  viewer,
  eager = true,
}: {
  pubkey: Hex
  viewer: Hex | undefined
  /** Whether this instance may build the social graph, or only read one already built. */
  eager?: boolean
}): React.ReactNode {
  /** Rooted at the SIGNED-IN reader, never at the profile being viewed. */
  const graph = useSocialGraph(viewer, { eager })
  const mutuals = useMemo(() => graph.mutuals(pubkey), [graph, pubkey])

  /** NOT on the reader's own profile. */
  if (viewer !== undefined && viewer === pubkey) return null

  /* SHOWN AS SOON AS THERE IS SOMEBODY TO NAME. */

  // Nothing to say, so nothing is said.
  if (mutuals.length === 0) return null

  /* NAMES ONLY. */
  return <FacePile lead="Followed by" people={mutuals} />
}

/** Three faces and a sentence naming them. */
export function FacePile({
  lead,
  people,
  className = 'mt-3 flex items-center gap-2.5 text-sm text-text-muted',
}: {
  /** The words before the names. */
  lead: string
  /** Already ordered by whatever the caller thinks matters. */
  people: readonly Hex[]
  className?: string
}): React.ReactNode {
  const faces = people.slice(0, FACES)
  const named = people.slice(0, NAMED)
  if (faces.length === 0) return null

  return (
    <div className={className}>
      {/* Overlapping, in the order they are named, with the leading face on top. */}
      <span className="flex shrink-0">
        {faces.map((friend, index) => (
          <FriendAvatar key={friend} pubkey={friend} depth={index} />
        ))}
      </span>

      <span className="min-w-0">
        {lead}{' '}
        {named.map((friend, index) => (
          <span key={friend}>
            {index === 0 ? '' : index === named.length - 1 ? (named.length > 2 ? ', and ' : ' and ') : ', '}
            <FriendName pubkey={friend} />
          </span>
        ))}
        .
      </span>
    </div>
  )
}

/** One face in the pile. */
function FriendAvatar({ pubkey, depth }: { pubkey: Hex; depth: number }): React.ReactNode {
  const profile = useProfile(pubkey)
  const name = profileDisplayName(profile ?? { pubkey })
  return (
    <Link
      href={profileHref(npubOf(pubkey))}
      onClick={event => event.stopPropagation()}
      title={name}
      aria-label={name}
      className={`relative -ml-2 rounded-full ring-2 ring-bg transition-transform first:ml-0 hover:z-40 hover:scale-110 ${DEPTH[depth] ?? 'z-0'}`}
    >
      <Avatar pubkey={pubkey} name={name} picture={profile?.picture} size="sm" />
    </Link>
  )
}

/** Leading face on top. */
const DEPTH = ['z-30', 'z-20', 'z-10'] as const

function FriendName({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const profile = useProfile(pubkey)
  return (
    <Link href={profileHref(npubOf(pubkey))} className="font-semibold text-text hover:underline">
      {profileDisplayName(profile ?? { pubkey })}
    </Link>
  )
}
