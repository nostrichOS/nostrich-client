'use client'

import { useEffect, useRef, useState } from 'react'
import { buildDeletion, buildReport, type NostrEvent } from '@nostrich/nostr'

import { markDeleted } from '../lib/deleted'
import { noteHref } from '../lib/links'
import { getPool } from '../lib/pool'
import { usePinnedId, usePinning } from '../lib/pinned'
import { addToList, inList, toggleList, useUserListsVersion } from '../lib/user-lists'
import { sessionPubkey, useSession } from './SessionProvider'

/** The ⋯ menu on a single note. */
export function NoteMenu({ event }: { event: NostrEvent }): React.ReactNode {
  const ref = useRef<HTMLDetailsElement>(null)
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const signer = session.status === 'signed' ? session.signer : undefined
  const [flash, setFlash] = useState<{ text: string; seq: number } | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const onClick = (clickEvent: MouseEvent): void => {
      const node = ref.current
      if (node !== null && node.open && !node.contains(clickEvent.target as Node)) node.open = false
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    if (flash === null) return
    const timer = setTimeout(() => setFlash(null), 2_000)
    return () => clearTimeout(timer)
  }, [flash?.seq])

  const announce = (text: string): void => {
    seq.current += 1
    setFlash({ text, seq: seq.current })
  }

  const close = (): void => {
    if (ref.current !== null) ref.current.open = false
  }

  const copy = async (value: string, label: string): Promise<void> => {
    close()
    try {
      await navigator.clipboard.writeText(value)
      announce(`${label} copied`)
    } catch {
      // Denied permission, or an insecure context.
      announce('Could not copy')
    }
  }

  /** NIP-09: a deletion is a REQUEST, not an erasure. */
  const requestDelete = async (): Promise<void> => {
    close()
    if (signer === undefined) return
    /* The caveat that used to follow. */
    if (!window.confirm('Ask relays to delete this note?')) {
      return
    }
    try {
      const template = buildDeletion(
        [{ id: event.id, kind: event.kind, pubkey: event.pubkey }],
        event.pubkey,
      )
      const signed = await signer.signEvent(template)
      const results = await getPool().publish(signed)
      if (!results.some(result => result.ok)) {
        announce('No relay accepted it')
        return
      }
      // The other half of "delete": stop showing it here.
      markDeleted(event.id)
      announce('Delete requested')
    } catch {
      announce('Delete cancelled')
    }
  }

  const link =
    typeof window === 'undefined' ? noteHref(event) : `${window.location.origin}${noteHref(event)}`
  // Only your own notes.
  const isMine = viewer !== undefined && viewer === event.pubkey
  const pinnedId = usePinnedId(isMine ? viewer : undefined)
  const pinned = pinnedId === event.id
  const pinning = usePinning(signer, viewer)

  // Subscribes this menu to mute changes, so the labels below flip the moment one.
  useUserListsVersion()

  const muted = inList('muted', event.pubkey)
  const repostsMuted = inList('mutedReposts', event.pubkey)

  const reportAndMute = async (): Promise<void> => {
    // Muted first and unconditionally: the local half works signed out and cannot fail.
    addToList('muted', event.pubkey)
    if (signer === undefined) {
      setFlash({ text: 'Muted', seq: Date.now() })
      return
    }
    try {
      const signed = await signer.signEvent(
        buildReport({ pubkey: event.pubkey, eventId: event.id, reportType: 'spam' }),
      )
      const results = await getPool().publish(signed)
      setFlash({
        text: results.some(result => result.ok) ? 'Reported and muted' : 'Muted, report not accepted',
        seq: Date.now(),
      })
    } catch {
      // Refused at the signer, or offline.
      setFlash({ text: 'Muted', seq: Date.now() })
    }
  }

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="More"
        onClick={clickEvent => clickEvent.stopPropagation()}
        className="flex size-8 cursor-pointer list-none items-center justify-center rounded-full text-text-faint transition-colors hover:bg-bg-inset hover:text-text [&::-webkit-details-marker]:hidden"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </summary>

      {/* The card underneath opens the thread on click. */}
      <div
        onClick={clickEvent => clickEvent.stopPropagation()}
        className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-bg-elevated py-1 shadow-lg"
      >
        <Item icon="link" label="Copy note link" onClick={() => void copy(link, 'Link')} />
        <Item icon="notes" label="Copy note text" onClick={() => void copy(event.content, 'Text')} />
        <Item icon="tag" label="Copy note ID" onClick={() => void copy(event.id, 'ID')} />
        {isMine ? null : (
          <>
            <div className="my-1 border-t border-border" />
            {/* Mute belongs HERE, on the note, not only on a profile page. */}
            <Item
              icon={muted ? 'volume_up' : 'volume_off'}
              label={muted ? 'Unmute author' : 'Mute author'}
              onClick={() => {
                const nowMuted = toggleList('muted', event.pubkey)
                setFlash({ text: nowMuted ? 'Muted' : 'Unmuted', seq: Date.now() })
              }}
            />
            <Item
              icon="repeat"
              label={repostsMuted ? 'Show reposts' : 'Mute reposts'}
              onClick={() => {
                const nowMuted = toggleList('mutedReposts', event.pubkey)
                setFlash({ text: nowMuted ? 'Reposts muted' : 'Reposts shown', seq: Date.now() })
              }}
            />
            {/* Report AND mute, in one action. */}
            <Item
              icon="flag"
              label="Report and mute"
              danger
              onClick={() => void reportAndMute()}
            />
          </>
        )}
        {isMine ? (
          <>
            <div className="my-1 border-t border-border" />
            {/* One pin per account, so this is a toggle rather than a list to manage. */}
            <Item
              icon={pinned ? 'keep_off' : 'keep'}
              label={pinned ? 'Unpin from profile' : 'Pin to profile'}
              onClick={() => {
                void (pinned ? pinning.unpin() : pinning.pin(event.id)).then((ok: boolean) => {
                  setFlash({ text: ok ? (pinned ? 'Unpinned' : 'Pinned') : 'No relay accepted it', seq: Date.now() })
                })
              }}
            />
            <Item
              icon="delete"
              label="Request delete"
              danger
              onClick={() => void requestDelete()}
            />
          </>
        ) : null}
      </div>

      {flash !== null ? (
        <span
          role="status"
          className="absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-md bg-text px-2 py-1 text-xs text-bg"
        >
          {flash.text}
        </span>
      ) : null}
    </details>
  )
}

function Item({
  icon,
  label,
  onClick,
  danger = false,
}: {
  /** Material Symbols name. */
  icon: string
  label: string
  onClick: () => void
  danger?: boolean
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-bg-inset ${
        danger ? 'text-danger-text' : 'text-text'
      }`}
    >
      <span className="material-symbols-outlined text-[19px]!" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}
