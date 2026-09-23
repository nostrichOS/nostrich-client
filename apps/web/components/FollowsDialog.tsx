'use client'

import { Link } from './AppLink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KINDS, parseContacts, profileDisplayName, type Hex } from '@nostrich/nostr'

import { useFollows } from '../lib/contacts'
import { npubOf } from '../lib/format'
import { profileHref } from '../lib/links'
import { getPool } from '../lib/pool'
import { useProfile } from '../lib/profiles'
import { Avatar } from './Avatar'
import { FollowButton } from './FollowButton'
import { VerifiedBadge } from './VerifiedBadge'
import { useNip05Verified } from '../lib/profiles'
import { openModal } from '../lib/modal'

/** Who someone follows, and who follows them. */

type TabId = 'following' | 'followers'

/** Relays cap a REQ well below. */
const FOLLOWER_LIMIT = 500
const TIMEOUT_MS = 8_000

export function FollowsDialog({
  pubkey,
  initialTab,
  followingTotal,
  followersTotal,
  onClose,
}: {
  pubkey: Hex
  initialTab: TabId
  /** From the profile header, so the count here cannot disagree with the one clicked. */
  followingTotal: number
  /** The header's follower figure, for the same reason. */
  followersTotal?: number
  onClose: () => void
}): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<TabId>(initialTab)
  const follows = useFollows(pubkey)

  useEffect(() => {
    const dialog = ref.current
    openModal(dialog)
  }, [])

  const followers = useQuery({
    queryKey: ['follower-list', pubkey],
    queryFn: async (): Promise<Hex[]> => {
      const events = await getPool().query(
        [{ kinds: [KINDS.contacts], '#p': [pubkey], limit: FOLLOWER_LIMIT }],
        undefined,
        TIMEOUT_MS,
      )
      // One follower may have their kind-3 on six relays.
      const newest = new Map<Hex, number>()
      for (const event of events) {
        // Guard against a relay returning a list that does not actually name us: the tag.
        if (!parseContacts(event).some(contact => contact.pubkey === pubkey)) continue
        const held = newest.get(event.pubkey)
        if (held === undefined || event.created_at > held) newest.set(event.pubkey, event.created_at)
      }
      return [...newest.entries()].sort((a, b) => b[1] - a[1]).map(([author]) => author)
    },
    // Only fetched when the tab is opened: it is a heavy query and most visits never ask.
    enabled: tab === 'followers',
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  })

  const shown = useMemo(
    () => (tab === 'following' ? follows.all : (followers.data ?? [])),
    [tab, follows.all, followers.data],
  )
  const loading = tab === 'following' ? follows.loading : followers.isPending

  return (
    <dialog
      /* Focusable so `openModal` can put the initial focus HERE rather than letting. */
      tabIndex={-1}
      ref={ref}
      onClose={onClose}
      onClick={clickEvent => {
        if (clickEvent.target === ref.current) onClose()
      }}
      className="m-auto flex h-[min(640px,calc(100dvh-4rem))] w-[min(460px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-bg-elevated p-0 text-text shadow-lg backdrop:bg-black/40"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-9 cursor-pointer items-center justify-center rounded-full text-text transition-colors hover:bg-bg-inset"
        >
          <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
            close
          </span>
        </button>
        <h2 className="flex-1 text-lg font-bold">Connections</h2>
      </div>

      <div role="tablist" aria-label="Connections" className="flex border-b border-border">
        {(
          [
            ['following', 'Following', followingTotal],
            ['followers', 'Followers', followersTotal ?? followers.data?.length],
          ] as [TabId, string, number | undefined][]
        ).map(([id, label, count]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="relative flex flex-1 cursor-pointer justify-center py-3 text-[15px] transition-colors hover:bg-bg-inset"
          >
            <span className="relative">
              <span className={tab === id ? 'font-bold text-text' : 'font-medium text-text-muted'}>
                {label}
                {count !== undefined && count > 0 ? (
                  <span className="ml-1.5 text-xs text-text-faint">{count.toLocaleString()}</span>
                ) : null}
              </span>
              {tab === id ? (
                <span aria-hidden="true" className="absolute -bottom-3 left-0 right-0 h-1 rounded-lg bg-text" />
              ) : null}
            </span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && shown.length === 0 ? (
          <ul aria-hidden="true" className="px-4">
            {[0, 1, 2, 3, 4, 5, 6].map(row => (
              <li key={row} className="flex gap-3 py-3">
                <div className="size-10 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 w-32 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
                  <div className="h-3 w-24 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
                </div>
              </li>
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">
            {tab === 'following' ? 'Not following anyone yet.' : 'No followers found on your relays.'}
          </p>
        ) : (
          <ul>
            {shown.map(person => (
              <PersonRow key={person} pubkey={person} onNavigate={onClose} />
            ))}
          </ul>
        )}
      </div>

    </dialog>
  )
}

function PersonRow({
  pubkey,
  onNavigate,
}: {
  pubkey: Hex
  onNavigate: () => void
}): React.ReactNode {
  const profile = useProfile(pubkey)
  const verified = useNip05Verified(profile?.nip05, pubkey)
  const name = profileDisplayName(profile ?? { pubkey })
  const handle = profile?.name?.trim()

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-inset">
        <Link
          href={profileHref(npubOf(pubkey))}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <Avatar pubkey={pubkey} name={name} picture={profile?.picture} size="md" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate font-semibold text-text">{name}</span>
              {verified ? <VerifiedBadge size={14} /> : null}
            </span>
            <span className="block truncate text-sm text-text-muted">
              @{handle !== undefined && handle !== '' ? handle : npubOf(pubkey).slice(5, 13)}
            </span>
          </span>
        </Link>
        <div className="shrink-0">
          <FollowButton target={pubkey} />
        </div>
      </div>
    </li>
  )
}
