'use client'

import { Link } from './AppLink'
import { useEffect, useRef, useState } from 'react'
import { profileDisplayName, type Hex } from '@nostrich/nostr'

import { compactCount, npubOf, relativeTime } from '../lib/format'
import { profileHref } from '../lib/links'
import { useNip05Verified, useProfile } from '../lib/profiles'
import type { Reactor, Reactors } from '../lib/reactors'
import { openModal } from '../lib/modal'
import { Avatar } from './Avatar'
import { ReactionMark } from './ReactionMark'
import { FollowButton } from './FollowButton'
import { VerifiedBadge } from './VerifiedBadge'

/** Who reacted, in four tabs. */

export type ReactionTab = 'zaps' | 'reposts' | 'quotes' | 'reactions'

export function ReactionsDialog({
  reactors,
  initialTab,
  onClose,
}: {
  reactors: Reactors
  initialTab: ReactionTab
  onClose: () => void
}): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<ReactionTab>(initialTab)

  useEffect(() => {
    const dialog = ref.current
    openModal(dialog)
  }, [])

  const tabs: [ReactionTab, string, Reactor[]][] = [
    ['zaps', 'Zaps', reactors.zaps],
    ['reposts', 'Reposts', reactors.reposts],
    ['quotes', 'Quotes', reactors.quotes],
    /* "Reactions", not "Likes": 46% of the kind-7s this list holds are an emoji somebody. */
    ['reactions', 'Reactions', reactors.reactions],
  ]
  const shown = tabs.find(([id]) => id === tab)?.[2] ?? []

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
        <h2 className="flex-1 text-lg font-bold">Reactions</h2>
      </div>

      <div role="tablist" aria-label="Reactions" className="flex border-b border-border">
        {tabs.map(([id, label, list]) => (
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
                {list.length > 0 ? (
                  <span className="ml-1.5 text-xs text-text-faint">{compactCount(list.length)}</span>
                ) : null}
              </span>
              {tab === id ? (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-3 left-0 right-0 h-1 rounded-lg bg-text"
                />
              ) : null}
            </span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          reactors.loading ? (
            <ul aria-hidden="true" className="px-4">
              {[0, 1, 2, 3, 4].map(row => (
                <li key={row} className="flex gap-3 py-3">
                  <div className="size-10 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 w-32 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
                    <div className="h-3 w-24 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-text-muted">
              {tab === 'zaps'
                ? 'No zaps on this note yet.'
                : tab === 'quotes'
                  ? 'Nobody has quoted this note yet.'
                  : `No ${tab} yet.`}
            </p>
          )
        ) : (
          <ul>
            {shown.map(person => (
              <ReactorRow key={person.pubkey} reactor={person} tab={tab} onNavigate={onClose} />
            ))}
          </ul>
        )}
      </div>

      {/* Said once, under the list, rather than as a caveat on every row. */}
      {reactors.loading ? null : (
        <p className="border-t border-border px-4 py-2.5 text-center text-xs leading-relaxed text-text-faint">
          Counted from the relays you read. Results may vary by relay.
        </p>
      )}
    </dialog>
  )
}

function ReactorRow({
  reactor,
  tab,
  onNavigate,
}: {
  reactor: Reactor
  tab: ReactionTab
  onNavigate: () => void
}): React.ReactNode {
  const profile = useProfile(reactor.pubkey)
  const verified = useNip05Verified(profile?.nip05, reactor.pubkey)
  const name = profileDisplayName(profile ?? { pubkey: reactor.pubkey })
  const handle = profile?.name?.trim()
  const now = Math.floor(Date.now() / 1000)

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-inset">
        <Link
          href={profileHref(npubOf(reactor.pubkey))}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <Avatar
            pubkey={reactor.pubkey}
            name={name}
            picture={profile?.picture}
            size="md"
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate font-semibold text-text">{name}</span>
              {verified ? <VerifiedBadge size={14} /> : null}
              {/* The zap AMOUNT belongs beside the name, not in a column of its own: it is the thing. */}
              {reactor.sats === undefined ? null : (
                <span className="shrink-0 text-sm font-bold text-zap-text">
                  {compactCount(reactor.sats)}
                </span>
              )}
              {/* What they actually sent. */}
              {reactor.emoji === undefined ? null : (
                <span className="shrink-0 text-sm">
                  <ReactionMark
                    mark={{
                      display: reactor.emoji,
                      ...(reactor.emojiUrl === undefined ? {} : { url: reactor.emojiUrl }),
                    }}
                  />
                </span>
              )}
            </span>
            <span className="block truncate text-sm text-text-muted">
              @{handle !== undefined && handle !== '' ? handle : npubOf(reactor.pubkey).slice(5, 13)}
              <span className="text-text-faint"> · {relativeTime(reactor.createdAt, now)}</span>
            </span>
            {reactor.comment === undefined ? null : (
              <span className="mt-0.5 block truncate text-sm text-text">{reactor.comment}</span>
            )}
          </span>
        </Link>

        {/* A quote is the one reaction with something to read, so its row offers the way. */}
        {tab === 'quotes' && reactor.quoteId !== undefined ? (
          <Link
            href={`/e/${reactor.quoteId}`}
            onClick={onNavigate}
            className="shrink-0 rounded-full border border-border px-3 py-1.5 text-sm font-bold text-text transition-colors hover:bg-bg-inset"
          >
            View
          </Link>
        ) : (
          <div className="shrink-0">
            <FollowButton target={reactor.pubkey} />
          </div>
        )}
      </div>
    </li>
  )
}
