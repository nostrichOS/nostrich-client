'use client'

import { useState } from 'react'
import { parseContacts, type Hex } from '@nostrich/nostr'

import { useQueryClient } from '@tanstack/react-query'

import {
  CONTACT_RELAYS,
  editContacts,
  losesFollows,
  MAX_FOLLOWS,
  refreshContacts,
  rememberContacts,
  useFollows,
} from '../lib/contacts'
import { getPool } from '../lib/pool'
import { useRouter } from 'next/navigation'

import { sessionPubkey, useSession } from './SessionProvider'

/** Follow / unfollow, by republishing the reader's whole kind-3 contact list. */
/** `chrome` is for the button when it sits on media chrome. */
export type FollowTone = 'default' | 'chrome'

const CHROME_BASE =
  // rounded-lg like every other action button.

  // `whitespace-nowrap shrink-0`.
  'flex h-9 shrink-0 items-center whitespace-nowrap rounded-lg px-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50'

export function FollowButton({
  target,
  tone = 'default',
}: {
  target: Hex
  tone?: FollowTone
}): React.ReactNode {
  const router = useRouter()
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const follows = useFollows(viewer)
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Optimistic overlay.
  const [local, setLocal] = useState<boolean | undefined>(undefined)

  const signer = session.status === 'signed' ? session.signer : undefined
  const signedIn = viewer !== undefined && signer !== undefined

  /** Nothing at all on your own account. */
  if (viewer !== undefined && viewer === target) return null

  // `all`, not `authors`: membership has to be tested against the whole list.
  const following = local ?? follows.all.includes(target)
  // Not merely "loading": until the list has resolved we do not know what to republish.
  const ready = follows.resolved

  const toggle = async (): Promise<void> => {
    if (!ready || busy || signer === undefined) return
    setBusy(true)
    setError(null)
    const next = !following
    /** THE BUTTON CHANGES NOW. */
    setLocal(next)
    try {
      /** ASKED AGAIN, RIGHT BEFORE WRITING. */
      const base = await refreshContacts(viewer as Hex)
      const template = editContacts(base, target, next)

      /* The last line of defence. */
      const lost = losesFollows(base, template)
      if (lost > (next ? 0 : 1)) {
        setLocal(undefined)
        setError('Your follow list came back incomplete. Nothing was changed, try again.')
        return
      }

      const signed = await signer.signEvent(template)
      /* Published to every relay this app READS contacts from, not just the write set. */
      const results = await getPool().publish(signed, CONTACT_RELAYS)
      if (!results.some(r => r.ok)) {
        // Every relay rejected.
        setLocal(undefined)
        setError('No relay accepted that. Try again.')
        return
      }
      // What was just published is now the newest thing that exists, whatever any relay says.
      rememberContacts(signed)
      const nextList = parseContacts(signed).map(contact => contact.pubkey)
      /** The cache is updated, not invalidated. */
      client.setQueryData(['follows', viewer ?? ''], {
        authors: nextList.slice(0, MAX_FOLLOWS),
        all: nextList,
        total: nextList.length,
      })
    } catch {
      setLocal(undefined)
      setError('Signing failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!signedIn) {
    return (
      <button
        type="button"
        onClick={() => router.push('/login')}
        className={
          tone === 'chrome'
            ? `${CHROME_BASE} bg-white/10 text-white hover:bg-white/20`
            : 'flex h-10 shrink-0 items-center whitespace-nowrap rounded-lg bg-bg-inset px-5 text-sm font-bold text-text-faint transition-colors hover:bg-border'
        }
      >
        Follow
      </button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void toggle()}
        /** NOT disabled while the write runs. */
        disabled={!ready}
        aria-busy={busy}
        /** Black when actionable, outlined once following. */
        className={
          // h-10 rather than py-2: the icon buttons beside it are size-10, and padding-based.
          tone === 'chrome'
            ? following
              ? `${CHROME_BASE} border border-white/30 text-white hover:bg-white/10`
              : `${CHROME_BASE} bg-white/10 text-white hover:bg-white/20`
            : following
              ? 'flex h-10 shrink-0 items-center whitespace-nowrap rounded-lg border border-border-strong bg-bg-elevated px-5 text-sm font-bold text-text transition-colors hover:bg-bg-inset disabled:cursor-not-allowed disabled:opacity-50'
              : 'flex h-10 shrink-0 items-center whitespace-nowrap rounded-lg bg-text px-5 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
        }
      >
        {/* The new state, not an ellipsis. */}
        {!ready ? 'Loading…' : following ? 'Following' : 'Follow'}
      </button>
      {error !== null ? (
        <span role="alert" className="text-xs text-danger-text">
          {error}
        </span>
      ) : null}
    </div>
  )
}
