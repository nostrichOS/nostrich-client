'use client'

import { useRouter } from 'next/navigation'

import { profileDisplayName, type Hex } from '@nostrich/nostr'

import { Avatar } from './Avatar'
import { npubOf } from '../lib/format'
import { useProfile } from '../lib/profiles'
import {
  clearSearches,
  forgetRecent,
  recentKey,
  useRecentSearches,
  type RecentEntry,
} from '../lib/recent-searches'

/** The recent-search list that drops under a focused search field. */
export function RecentSearches({
  onPick,
  onClose,
}: {
  onPick: (term: string) => void
  onClose: () => void
}): React.ReactNode {
  const recent = useRecentSearches()
  const router = useRouter()

  // Nothing remembered, nothing to show.
  if (recent.length === 0) return null

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-2xl border border-border bg-bg-elevated py-2 shadow-lg">
      <div className="flex items-center justify-between px-4 py-2">
        <h2 className="text-lg font-bold text-text">Recent</h2>
        <button
          type="button"
          /** `onMouseDown` with preventDefault, not `onClick`. */
          onMouseDown={event => {
            event.preventDefault()
            clearSearches()
          }}
          className="cursor-pointer text-sm font-semibold text-link hover:underline"
        >
          Clear all
        </button>
      </div>

      <ul>
        {recent.map(entry => (
          <li
            key={recentKey(entry)}
            className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-bg-inset"
          >
            <button
              type="button"
              onMouseDown={event => {
                event.preventDefault()
                /* A profile opens. */
                if (entry.kind === 'profile') router.push(`/p/${npubOf(entry.pubkey)}`)
                else onPick(entry.term)
                onClose()
              }}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
            >
              {entry.kind === 'profile' ? (
                <ProfileRow pubkey={entry.pubkey} />
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width={19} height={19} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="shrink-0 text-nav-icon">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.5-4.5" />
                  </svg>
                  <span className="min-w-0 truncate text-[15px] text-text">{entry.term}</span>
                </>
              )}
            </button>
            <button
              type="button"
              aria-label="Remove from recent"
              onMouseDown={event => {
                event.preventDefault()
                forgetRecent(entry)
              }}
              className="shrink-0 cursor-pointer rounded-full p-1 text-text-faint transition-colors hover:bg-bg-inset hover:text-text"
            >
              <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                <path d="M5 5l14 14M19 5L5 19" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A visited profile, shown the way the reader will recognise it: face, name, handle. */
function ProfileRow({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const profile = useProfile(pubkey)
  const name = profileDisplayName({ ...profile, pubkey })
  const handle = profile?.nip05?.split('@')[0] ?? profile?.name
  return (
    <>
      <Avatar pubkey={pubkey} name={name} picture={profile?.picture} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-text">{name}</span>
        <span className="block truncate text-[13px] text-text-faint">
          {handle === undefined ? npubOf(pubkey).slice(0, 16) + '…' : `@${handle}`}
        </span>
      </span>
    </>
  )
}
