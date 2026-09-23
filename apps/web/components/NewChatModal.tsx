'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeHexKey, profileDisplayName, type Hex } from '@nostrich/nostr'

import { useChat } from '../lib/chat'
import { useFollows } from '../lib/contacts'
import { useProfileSearch } from '../lib/profile-search'
import { resolveEntity } from '../lib/entity'
import { useProfile } from '../lib/profiles'
import { openModal } from '../lib/modal'
import { Avatar } from './Avatar'

/** Picking who to message. */
export function NewChatModal({
  self,
  onClose,
  onPick,
}: {
  self: Hex
  onClose: () => void
  onPick: (pubkey: Hex) => void
}): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  // The dialog opens onto this box and the reader is about to type.
  const searchRef = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState('')
  const follows = useFollows(self)
  // Who you have actually talked to, newest conversation first.
  const chat = useChat(self)
  // The wider network, only once there is something to look.
  const search = useProfileSearch(term, term.trim().length >= 2)

  useEffect(() => {
    const dialog = ref.current
    openModal(dialog, searchRef.current)
  }, [])

  /** An npub, nprofile or hex key typed straight into the box. */
  const pasted = useMemo((): Hex | undefined => {
    const value = term.trim()
    if (value === '') return undefined
    const hex = normalizeHexKey(value)
    if (hex !== null) return hex
    const resolved = resolveEntity(value, 'profile')
    return resolved?.kind === 'profile' ? resolved.hex : undefined
  }, [term])

  const candidates = useMemo(
    /** Three tiers, in the order a person actually thinks about them. */
    () => {
      const recent = chat.conversations
        .flatMap(conversation => conversation.participants)
        .filter(pubkey => pubkey !== self)
      const seen = new Set<Hex>()
      const ordered: Hex[] = []
      for (const pubkey of [...recent, ...follows.all]) {
        if (pubkey === self || seen.has(pubkey)) continue
        seen.add(pubkey)
        ordered.push(pubkey)
      }
      return { list: ordered.slice(0, 300), recentCount: new Set(recent).size }
    },
    [chat.conversations, follows.all, self],
  )

  return (
    <dialog
      /* Focusable so `openModal` can put the initial focus HERE rather than letting. */
      tabIndex={-1}
      ref={ref}
      onClose={onClose}
      onClick={event => {
        // Clicking the backdrop closes.
        if (event.target === ref.current) onClose()
      }}
      /* Nudged up 5px on a desktop. */
      className="m-auto w-[min(480px,calc(100vw-2rem))] rounded-2xl border border-border bg-bg-elevated p-0 text-text shadow-lg backdrop:bg-black/40 sm:-translate-y-[5px]"
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
        <h2 className="flex-1 text-lg font-bold">New message</h2>
      </div>

      <div className="px-4 py-3">
        <label htmlFor="new-chat-q" className="sr-only">
          Search people, or paste an npub
        </label>
        <input
          id="new-chat-q"
          ref={searchRef}
          value={term}
          onChange={event => setTerm(event.target.value)}
          placeholder="Search people, or paste an npub"
          className="w-full rounded-full border border-transparent bg-bg-inset px-4 py-2.5 text-text placeholder:text-text-faint focus:outline-none"
        />
      </div>

      <div className="max-h-[50vh] min-h-[200px] overflow-y-auto px-2 pb-3">
        {pasted !== undefined && pasted !== self ? (
          <PersonRow pubkey={pasted} term="" onPick={onPick} />
        ) : null}

        {candidates.list.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">
            Nobody to show yet. Search for someone, or paste an npub.
          </p>
        ) : (
          candidates.list.map((pubkey, index) => (
            <PersonRow
              key={pubkey}
              pubkey={pubkey}
              term={term}
              onPick={onPick}
              // The first row of each tier carries the heading, so the list explains its own order.
              {...(index === 0 && candidates.recentCount > 0
                ? { heading: 'Recent' }
                : index === candidates.recentCount
                  ? { heading: 'Following' }
                  : {})}
            />
          ))
        )}

        {/* THE WIDER NETWORK, under its own heading and never mixed in above. */}
        {term.trim().length >= 2 && search.profiles.length > 0 ? (
          <>
            <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-text-faint">
              Everyone else
            </p>
            {search.profiles
              .filter(hit => hit.pubkey !== self && !candidates.list.includes(hit.pubkey))
              .slice(0, 20)
              .map(hit => (
                <PersonRow key={hit.pubkey} pubkey={hit.pubkey} term="" onPick={onPick} />
              ))}
          </>
        ) : null}
      </div>
    </dialog>
  )
}

function PersonRow({
  pubkey,
  term,
  heading,
  onPick,
}: {
  pubkey: Hex
  term: string
  /** Rendered above this row, so a group label cannot be left behind by a filtered-out. */
  heading?: string
  onPick: (pubkey: Hex) => void
}): React.ReactNode {
  const profile = useProfile(pubkey)
  const name = profileDisplayName(profile ?? { pubkey })
  const handle = profile?.nip05 ?? ''

  const needle = term.trim().toLowerCase()
  if (needle !== '' && !`${name} ${handle}`.toLowerCase().includes(needle)) return null

  return (
    <>
      {heading === undefined ? null : (
        <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-text-faint">
          {heading}
        </p>
      )}
    <button
      type="button"
      onClick={() => onPick(pubkey)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-bg-inset"
    >
      <Avatar pubkey={pubkey} name={name} picture={profile?.picture} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-text">{name}</span>
        {handle !== '' ? (
          <span className="block truncate text-sm text-text-muted">{handle}</span>
        ) : null}
      </span>
    </button>
    </>
  )
}
