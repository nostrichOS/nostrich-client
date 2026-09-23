'use client'

import { useEffect, useRef, useState } from 'react'
import { profileDisplayName, type Hex, type Profile } from '@nostrich/nostr'

import { asset } from '../lib/assets'
import { npubOf } from '../lib/format'
import { openModal } from '../lib/modal'
import { Avatar } from './Avatar'
import { QrCode } from './QrCode'
import { VerifiedBadge } from './VerifiedBadge'

/** An account as something you can point a phone. */

type TabId = 'key' | 'lightning'

export function ProfileQrDialog({
  pubkey,
  profile,
  verified,
  onClose,
}: {
  pubkey: Hex
  profile: Profile | null
  verified: boolean
  onClose: () => void
}): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<TabId>('key')
  const [copied, setCopied] = useState<string | undefined>(undefined)

  useEffect(() => {
    const dialog = ref.current
    openModal(dialog)
  }, [])

  useEffect(() => {
    if (copied === undefined) return
    const timer = setTimeout(() => setCopied(undefined), 1_500)
    return () => clearTimeout(timer)
  }, [copied])

  const npub = npubOf(pubkey)
  const lightning = profile?.lud16 ?? profile?.lud06 ?? ''
  const name = profileDisplayName(profile ?? { pubkey })
  const showing: TabId = lightning === '' ? 'key' : tab

  const copy = async (value: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
    } catch {
      setCopied('Could not copy')
    }
  }

  return (
    <dialog
      /* Focusable so `openModal` can put the initial focus HERE rather than letting. */
      tabIndex={-1}
      ref={ref}
      onClose={onClose}
      onClick={clickEvent => {
        if (clickEvent.target === ref.current) onClose()
      }}
      className="m-auto w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-border bg-bg-elevated p-0 text-text shadow-lg backdrop:bg-black/40"
    >
      <div className="flex items-start gap-3 px-5 pt-5">
        <Avatar pubkey={pubkey} name={name} picture={profile?.picture} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-lg font-bold text-text">{name}</span>
            {verified ? <VerifiedBadge size={16} /> : null}
          </p>
          {verified && profile?.nip05 !== undefined ? (
            <p className="truncate text-sm text-text-muted">{profile.nip05}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-text transition-colors hover:bg-bg-inset"
        >
          <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {/* Only when there is a second thing to show. */}
      {lightning !== '' ? (
        <div role="tablist" aria-label="Code" className="mt-5 flex justify-center gap-8">
          {(
            [
              ['key', 'Public key'],
              ['lightning', 'Lightning address'],
            ] as [TabId, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={showing === id}
              onClick={() => setTab(id)}
              className="relative cursor-pointer pb-2 text-[15px] transition-colors"
            >
              <span className={showing === id ? 'font-bold text-text' : 'font-medium text-text-muted'}>
                {label}
              </span>
              {showing === id ? (
                <span aria-hidden="true" className="absolute -bottom-px left-0 right-0 h-1 rounded-lg bg-text" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex justify-center px-5 py-6">
        {/* White plate regardless of theme. */}
        <div className="rounded-2xl bg-white p-4">
          <QrCode
            value={showing === 'key' ? `nostr:${npub}` : lightning}
            size={248}
            label={showing === 'key' ? `QR code for ${npub}` : `QR code for ${lightning}`}
          />
        </div>
      </div>

      <div className="border-t border-border px-5 py-4">
        <Row
          label="Public key"
          value={`${npub.slice(0, 14)}…${npub.slice(-12)}`}
          onCopy={() => void copy(npub, 'Public key copied')}
        />
        {lightning !== '' ? (
          <Row
            label="Lightning address"
            value={lightning}
            onCopy={() => void copy(lightning, 'Lightning address copied')}
          />
        ) : null}
        <p role="status" className="mt-2 h-4 text-right text-xs text-text-faint">
          {copied ?? ''}
        </p>
      </div>
    </dialog>
  )
}

function Row({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: () => void
}): React.ReactNode {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="shrink-0 text-sm text-text-muted">{label}:</span>
      <span className="min-w-0 flex-1 truncate text-right font-mono text-sm text-text">{value}</span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${label.toLowerCase()}`}
        className="shrink-0 cursor-pointer rounded-md p-1 text-text-faint transition-colors hover:bg-bg-inset hover:text-text"
      >
        <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
          content_copy
        </span>
      </button>
    </div>
  )
}

/** The button that opens it. Uses the QR glyph from the logo set. */
export function ProfileQrButton({ onClick }: { onClick: () => void }): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Show QR code"
      title="Show QR code"
      // Same 40px box and same ink as Zap, Chat and the overflow menu beside.
      className="flex size-10 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static asset, fixed size. */}
      <img src={asset('/qr-icon.svg')} alt="" className="size-[19px]" />
    </button>
  )
}
