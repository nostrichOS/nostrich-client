'use client'

import { Link } from './AppLink'
import { profileDisplayName } from '@nostrich/nostr'

import { asset } from '../lib/assets'
import { npubOf } from '../lib/format'
import { profileHref } from '../lib/links'
import { useNip05Verified, useProfile } from '../lib/profiles'
import type { ProfileHit } from '../lib/profile-search'
import { Avatar } from './Avatar'
import { sessionPubkey, useSession } from './SessionProvider'
import { VerifiedBadge } from './VerifiedBadge'
import { FollowButton } from './FollowButton'

/** One person in a list of search results. */
export function UserResult({ hit }: { hit: ProfileHit }): React.ReactNode {
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const live = useProfile(hit.pubkey)
  const profile = live ?? {
    pubkey: hit.pubkey,
    ...(hit.name === undefined ? {} : { name: hit.name }),
    ...(hit.displayName === undefined ? {} : { displayName: hit.displayName }),
    ...(hit.picture === undefined ? {} : { picture: hit.picture }),
    ...(hit.nip05 === undefined ? {} : { nip05: hit.nip05 }),
    ...(hit.about === undefined ? {} : { about: hit.about }),
  }
  const verified = useNip05Verified(profile.nip05, hit.pubkey)
  const name = profileDisplayName(profile)

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex gap-3 px-4 py-3 transition-colors hover:bg-bg-elevated sm:px-5">
        <Link href={profileHref(npubOf(hit.pubkey))} className="shrink-0">
          <Avatar pubkey={hit.pubkey} name={name} picture={profile.picture} size="lg" />
        </Link>

        <div className="min-w-0 flex-1">
          <Link href={profileHref(npubOf(hit.pubkey))} className="block min-w-0">
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate font-bold text-text">{name}</span>
              {verified ? (
                <VerifiedBadge size={15} mine={hit.pubkey === viewer} />
              ) : null}
            </span>
            {/* Only a VERIFIED nip05 is shown as a handle. */}
            {verified && profile.nip05 !== undefined ? (
              <span className="block truncate text-sm text-text-muted">{profile.nip05}</span>
            ) : null}
            {/* NO BIO. A search result is a NAME and a HANDLE and nothing else. */}
          </Link>
        </div>

        <div className="shrink-0 self-start">
          <FollowButton target={hit.pubkey} />
        </div>
      </div>
    </li>
  )
}
