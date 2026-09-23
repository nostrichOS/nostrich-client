'use client'

import { Link } from './AppLink'
import { isReply, profileDisplayName, type Hex, type NostrEvent } from '@nostrich/nostr'

import { getCachedEvent } from '../lib/event-cache'
import { npubOf } from '../lib/format'
import { profileHref } from '../lib/links'
import { useProfile } from '../lib/profiles'
import { parentOf } from '../lib/thread'

/** "Replying to @alice", above a reply that is being shown out of its thread. */
function repliedToPubkey(event: NostrEvent): Hex | undefined {
  const parentId = parentOf(event)
  if (parentId !== undefined) {
    const parent = getCachedEvent(parentId)
    if (parent !== undefined) return parent.pubkey as Hex
  }
  const mentioned = event.tags.filter(tag => tag[0] === 'p' && typeof tag[1] === 'string')
  return mentioned.length === 1 ? (mentioned[0]?.[1] as Hex) : undefined
}

export function ReplyingTo({ event }: { event: NostrEvent }): React.ReactNode {
  const target = isReply(event) ? repliedToPubkey(event) : undefined
  const profile = useProfile(target)
  if (target === undefined) return null
  // Never about the author themselves: a self-thread is one person continuing.
  if (target === event.pubkey) return null

  const name = profileDisplayName(profile ?? { pubkey: target })
  return (
    <span className="mb-2 block text-[15px] leading-tight text-text-muted">
      Replying to{' '}
      <Link
        href={profileHref(npubOf(target))}
        onClick={click => click.stopPropagation()}
        /* THE SAME GREY AS THE SENTENCE AROUND IT, and as the "hidden replies. */
        className="hover:underline hover:decoration-1 hover:underline-offset-2"
      >
        @{name}
      </Link>
    </span>
  )
}
