'use client'

import { useMemo, useState } from 'react'
import { PATHS } from '@nostrich/app'
import { decodeBolt11 } from '@nostrich/nostr'

import { payInvoice, useNwcClient } from '../lib/wallet'
import { asset } from '../lib/assets'
import { QrCode } from './QrCode'
import { sessionPubkey, useSession } from './SessionProvider'

/** A payable lightning invoice, drawn as a card. */
export function InvoiceCard({ bolt11 }: { bolt11: string }): React.ReactNode {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const client = useNwcClient(pubkey)

  const [showQr, setShowQr] = useState(false)
  const [copied, setCopied] = useState(false)
  const [paying, setPaying] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | undefined>(undefined)

  const decoded = useMemo(() => decodeBolt11(bolt11), [bolt11])
  // Undecodable means we cannot say what it is worth or whether it has expired.
  if (decoded === null) return <span className="text-sm text-text-muted">⚡ Lightning invoice</span>

  const sats = decoded.amountMsat === null ? undefined : Math.round(decoded.amountMsat / 1000)
  const expiresAt = decoded.timestamp + decoded.expirySeconds
  const expired = expiresAt * 1000 < Date.now()

  const copy = (): void => {
    void navigator.clipboard?.writeText(bolt11).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1_800)
      },
      () => undefined,
    )
  }

  const pay = async (): Promise<void> => {
    setPaying(true)
    setOutcome(undefined)
    const result = await payInvoice(client, bolt11)
    setPaying(false)
    setOutcome(
      result.ok
        ? { ok: true, message: 'Paid' }
        : // The wallet's own words.
          // from "no verdict arrived", and the second must never read as a refusal.
          { ok: false, message: result.message },
    )
  }

  return (
    <span
      onClick={event => event.stopPropagation()}
      className="mt-3 block rounded-2xl bg-bg-inset p-4"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" fill="currentColor" className="text-zap">
            <path d={PATHS.zap} />
          </svg>
          <span className="text-[15px] font-bold text-text">Lightning Invoice</span>
        </span>

        {/* QR and copy, top right. */}
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setShowQr(true)}
            aria-label="Show QR code"
            title="Show QR code"
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-hover hover:text-text"
          >
            {/* The app's own QR glyph, the same asset the profile header uses. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- static asset, fixed size. */}
            <img src={asset('/qr-icon.svg')} alt="" className="size-[18px]" />
          </button>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy invoice"
            title="Copy invoice"
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <span className="material-symbols-outlined text-[20px]!" aria-hidden="true">
              {copied ? 'check' : 'content_copy'}
            </span>
          </button>
        </span>
      </span>

      {/* The amount, big. An "any amount" invoice says so rather than showing a zero. */}
      <span className="mt-2 block text-[28px] font-bold leading-tight text-text">
        {sats === undefined ? 'Any amount' : `${sats.toLocaleString()} sats`}
      </span>

      {decoded.description === undefined || decoded.description === '' ? null : (
        <span className="mt-1 line-clamp-2 text-sm text-text-muted">{decoded.description}</span>
      )}

      {/* Pay on the LEFT, expiry on the right. */}
      <span className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={expired || paying || outcome?.ok === true}
          onClick={() => void pay()}
          className="cursor-pointer rounded-full bg-zap px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {outcome?.ok === true ? 'Paid' : paying ? 'Paying…' : 'Pay'}
        </button>

        <span className="min-w-0 text-right text-[13px] text-text-faint">
          {expired ? 'Expired' : `Expires ${relativeExpiry(expiresAt)}`}
        </span>
      </span>

      {outcome === undefined || outcome.ok ? null : (
        <span className="mt-2 block text-[13px] text-danger-text">{outcome.message}</span>
      )}

      {showQr ? (
        <span
          onClick={() => setShowQr(false)}
          className="mt-3 flex cursor-pointer justify-center rounded-xl bg-bg p-4"
        >
          <QrCode value={bolt11.toUpperCase()} size={200} label="Lightning invoice" />
        </span>
      ) : null}
    </span>
  )
}

/** `in 6 days`, `in 2 hours`. */
function relativeExpiry(at: number): string {
  const seconds = at - Math.floor(Date.now() / 1000)
  if (seconds < 3_600) return `in ${Math.max(1, Math.round(seconds / 60))} min`
  if (seconds < 86_400) return `in ${Math.round(seconds / 3_600)} hours`
  return `in ${Math.round(seconds / 86_400)} days`
}
