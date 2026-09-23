'use client'

import { Link } from './AppLink'
import { profileDisplayName, type Hex } from '@nostrich/nostr'

import { npubOf } from '../lib/format'
import { profileHref } from '../lib/links'
import { useProfile } from '../lib/profiles'
import { InteractionIcon } from './InteractionIcon'

/** "<Name> reposted", above the note that was reposted. */
export function RepostHeader({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const profile = useProfile(pubkey)
  const name = profileDisplayName(profile ?? { pubkey })

  return (
    <p className="flex items-center gap-2 pl-[70px] pt-2.5 text-[13px] font-semibold text-text-muted">
      <InteractionIcon name="repost" size={15} />
      <Link
        href={profileHref(npubOf(pubkey))}
        onClick={event => event.stopPropagation()}
        className="min-w-0 truncate hover:underline"
      >
        {name} reposted
      </Link>
    </p>
  )
}
