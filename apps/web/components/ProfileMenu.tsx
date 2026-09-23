'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildReport, type Hex } from '@nostrich/nostr'

import { useCustomFeeds } from '../lib/custom-feeds'
import { npubOf } from '../lib/format'
import { getPool } from '../lib/pool'
import { useUserList } from '../lib/user-lists'
import type { ActionIconName } from '@nostrich/app'

import { FeedEditor } from './FeedEditor'
import { InteractionIcon } from './InteractionIcon'
import { sessionPubkey, useSession } from './SessionProvider'

/** The overflow menu on a profile. */
export function ProfileMenu({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const ref = useRef<HTMLDetailsElement>(null)
  const router = useRouter()
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const signer = session.status === 'signed' ? session.signer : undefined

  const muted = useUserList('muted')
  const mutedReposts = useUserList('mutedReposts')
  const customFeeds = useCustomFeeds()
  /** Keyed on an occurrence counter, not on the message text. */
  const [flash, setFlash] = useState<{ text: string; seq: number } | null>(null)
  const seq = useRef(0)
  const announce = (text: string): void => {
    seq.current += 1
    setFlash({ text, seq: seq.current })
  }
  // The menu has two panes.
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const node = ref.current
      if (node !== null && node.open && !node.contains(event.target as Node)) node.open = false
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    if (flash === null) return
    const timer = setTimeout(() => setFlash(null), 2_000)
    return () => clearTimeout(timer)
  }, [flash?.seq])

  const close = (): void => {
    if (ref.current !== null) ref.current.open = false
    // Reset to the top pane, so reopening never lands mid-flow in the picker.
    setPicking(false)
  }

  const copy = async (value: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      announce(`${label} copied`)
    } catch {
      announce('Could not copy')
    }
    close()
  }

  const report = async (): Promise<void> => {
    close()
    if (signer === undefined) {
      router.push('/login')
      return
    }
    try {
      // NIP-56. A report is a signed public event, not a message to us.
      const signed = await signer.signEvent(buildReport({ pubkey, reportType: 'spam' }))
      const results = await getPool().publish(signed)
      announce(results.some(r => r.ok) ? 'Report published' : 'No relay accepted the report')
    } catch {
      announce('Report cancelled')
    }
  }

  const npub = npubOf(pubkey)
  const isSelf = viewer === pubkey

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="More options"
        className="flex size-10 cursor-pointer list-none items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:bg-bg-inset hover:text-text [&::-webkit-details-marker]:hidden"
      >
        <span className="material-symbols-outlined text-[20px]!" aria-hidden="true">
          more_horiz
        </span>
      </summary>

      {/* OPENS TO THE RIGHT ON A PHONE, to the left on a desktop. */}
      <div className="absolute left-0 z-40 mt-2 w-64 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-bg-elevated py-1 shadow-lg sm:left-auto sm:right-0">
        {picking ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <button
                type="button"
                onClick={() => setPicking(false)}
                aria-label="Back"
                className="rounded-lg px-1 text-text-muted hover:bg-bg-inset hover:text-text"
              >
                <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
                  arrow_back
                </span>
              </button>
              <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">
                Add to feed
              </span>
            </div>
            {customFeeds.feeds.map(item => {
              const member = item.authors.includes(pubkey)
              return (
                <Item
                  key={item.id}
                  icon={member ? 'check' : 'add'}
                  label={item.name}
                  onClick={() => {
                    if (member) {
                      customFeeds.update(item.id, { authors: item.authors.filter(a => a !== pubkey) })
                      announce(`Removed from ${item.name}`)
                    } else {
                      customFeeds.addAuthor(item.id, pubkey)
                      announce(`Added to ${item.name}`)
                    }
                    close()
                  }}
                />
              )
            })}
            {customFeeds.feeds.length === 0 ? (
              <p className="px-4 py-2 text-xs text-text-faint">No feeds yet.</p>
            ) : null}
            <Item
              icon="playlist_add"
              label="New feed…"
              onClick={() => {
                setCreating(true)
                close()
              }}
            />
          </>
        ) : (
          <>
            {isSelf ? null : (
              <>
                {/* A mute that is ON looks. */}
                <Item
                  icon={muted.has(pubkey) ? 'volume_up' : 'volume_off'}
                  label={muted.has(pubkey) ? 'Unmute user' : 'Mute user'}
                  danger={muted.has(pubkey)}
                  {...(muted.has(pubkey) ? { trailing: 'check' } : {})}
                  onClick={() => {
                    // Read BEFORE the toggle.
                    const wasMuted = muted.has(pubkey)
                    muted.toggle(pubkey)
                    announce(wasMuted ? 'Unmuted' : 'Muted')
                    close()
                  }}
                />
                <Item
                  glyph="repost"
                  label={mutedReposts.has(pubkey) ? 'Show reposts' : 'Mute reposts'}
                  danger={mutedReposts.has(pubkey)}
                  {...(mutedReposts.has(pubkey) ? { trailing: 'check' } : {})}
                  onClick={() => {
                    // Read before toggling, for the same reason as the mute above.
                    const wasMuted = mutedReposts.has(pubkey)
                    mutedReposts.toggle(pubkey)
                    announce(wasMuted ? 'Reposts shown' : 'Reposts muted')
                    close()
                  }}
                />
              </>
            )}
            <Item
              icon="link"
              label="Copy user link"
              onClick={() => void copy(`${window.location.origin}/p/${npub}`, 'Link')}
            />
            <Item icon="key" label="Copy user pubkey" onClick={() => void copy(npub, 'npub')} />
            {/* LAST, under the harmless things. */}
            {isSelf ? null : (
              <Item icon="flag" label="Report user" danger onClick={() => void report()} />
            )}
          </>
        )}
      </div>

      {/* Seeded with this account already in it, so "New feed…" from a profile is one step. */}
      {creating ? (
        <FeedEditor
          api={customFeeds}
          seedAuthors={[pubkey]}
          onClose={() => setCreating(false)}
          onCreated={created => router.push(`/?feed=custom&id=${encodeURIComponent(created.id)}`)}
        />
      ) : null}

      {flash !== null ? (
        <span
          role="status"
          className="absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-lg bg-text px-3 py-1.5 text-xs font-medium text-bg"
        >
          {flash.text}
        </span>
      ) : null}
    </details>
  )
}

function Item({
  icon,
  glyph,
  label,
  onClick,
  danger = false,
  trailing,
}: {
  /** A Material Symbols name, for concepts with no counterpart in the app's own icon set. */
  icon?: string
  /** One of the app's five interaction glyphs. */
  glyph?: ActionIconName
  label: string
  onClick: () => void
  danger?: boolean
  /** Glyph at the right edge. A chevron marks the one item that opens a second pane. */
  trailing?: string
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-bg-inset ${
        danger ? 'text-danger-text' : 'text-text'
      }`}
    >
      {glyph !== undefined ? (
        <InteractionIcon name={glyph} size={19} />
      ) : (
        <span className="material-symbols-outlined text-[20px]!" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing !== undefined ? (
        <span
          className={`material-symbols-outlined text-[18px]! ${danger ? '' : 'text-text-faint'}`}
          aria-hidden="true"
        >
          {trailing}
        </span>
      ) : null}
    </button>
  )
}
