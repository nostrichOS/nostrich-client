'use client'

import { useEffect, useRef, useState } from 'react'
import { Link } from './AppLink'
import { profileDisplayName, type Hex, type NostrEvent, type Signer } from '@nostrich/nostr'

import { npubOf } from '../lib/format'
import { useProfile } from '../lib/profiles'
import { openModal } from '../lib/modal'
import { DEFAULT_ZAP_PRESETS, hasWebln, knownInsufficient, type ZapPreset, useDefaultZap, useNwcClient, useWallet, useZapPresets } from '../lib/wallet'
import { fire, tierFor } from '../lib/fx/engine'
import {
  canReceiveZaps,
  paymentFailureText,
  sendZap,
} from '../lib/zap-send'

import { addPendingZap, settlePendingZap } from '../lib/zap-store'
import { Avatar } from './Avatar'
import { InteractionIcon } from './InteractionIcon'
import { formatCount } from '../lib/fx/count'

/** Sending a zap: pick an amount, add a note, pay. */

const EMOJI = [
  '⚡', '🔥', '🤙', '💜', '🚀', '👏', '🫂',
  '😂', '🙌', '🫡', '🧡', '🎉', '💎', '💯',
  '☕', '🍻', '🍷', '👑', '🎯', '🦾', '🤯',
]

type Stage = 'amount' | 'paying' | 'done'

export function ZapDialog({
  viewer,
  recipient,
  event,
  signer,
  initialError,
  initialNotice,
  onZapped,
  onClose,
}: {
  /** Who is paying. */
  viewer: Hex | undefined
  recipient: Hex
  /** Set when zapping a note. */
  event?: NostrEvent
  signer: Signer
  /** Why the reader is looking at this rather than at a zap that already happened. */
  initialError?: string
  /** Something that happened rather than something that went wrong. */
  initialNotice?: string
  /** Fired once the invoice is paid, so the caller can light its bolt without a round. */
  onZapped?: (sats: number) => void
  onClose: () => void
}): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const profile = useProfile(recipient)
  const client = useNwcClient(viewer)
  const { connection } = useWallet(viewer)
  const walletPubkey = connection?.walletPubkey
  const [defaultZap, setDefaultZap] = useDefaultZap()
  const [presets, writePresets] = useZapPresets()

  const [sats, setSats] = useState(defaultZap)
  const [custom, setCustom] = useState('')
  const [comment, setComment] = useState('')
  const [stage, setStage] = useState<Stage>('amount')
  const [error, setError] = useState<string | undefined>(initialError)
  const [warning, setWarning] = useState<string | undefined>(initialNotice)
  const [editing, setEditing] = useState(false)
  const [editIndex, setEditIndex] = useState(0)
  const commit = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    openModal(ref.current)
  }, [])

  const name = profileDisplayName(profile ?? { pubkey: recipient })
  const canReceive = canReceiveZaps(profile)
  const canPay = client !== undefined || hasWebln()
  const amount = custom.trim() === '' ? sats : Number(custom.trim())
  const amountValid = Number.isInteger(amount) && amount > 0

  const send = (): void => {
    if (!amountValid || profile === null) return

    /** THE DIALOG CLOSES ON THE PRESS. */
    /* THE ONE CHECK WORTH MAKING, and it happens before anything is sent. */
    if (knownInsufficient(amount, walletPubkey)) {
      setError(`Not enough sats in your wallet to zap ${amount.toLocaleString()}.`)
      return
    }

    const box = commit.current?.getBoundingClientRect()
    if (box !== undefined) fire(tierFor(amount), box.left + box.width / 2, box.top + box.height / 2)
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(6 + 4 * tierFor(amount))
      } catch {
        // Blocked by a permissions policy.
      }
    }
    onZapped?.(amount)
    // The amount somebody actually sends is a better default than the one.
    if (custom.trim() !== '') setDefaultZap(amount)

    /* On the strip immediately, in whichever slot the amount earns. */
    const optimistic =
      event === undefined || viewer === undefined
        ? undefined
        : addPendingZap(event.id, {
            sender: viewer,
            sats: amount,
            ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
            at: Math.floor(Date.now() / 1000),
          })

    const sending = sendZap({
      recipient,
      profile,
      ...(event === undefined ? {} : { event }),
      amountSats: amount,
      comment,
      signer,
      client,
    })

    setStage('done')
    onClose()

    void sending.then(result => {
      // A failure takes the optimistic entry back off the strip.
      if (optimistic !== undefined && event !== undefined) {
        settlePendingZap(event.id, optimistic, result.ok)
      }
      /* NOTHING IS SAID WHEN IT FAILS, and that is deliberate. */
    })
  }

  /** One write point for the templates, so the tiles and the store cannot drift. */
  const editPreset = (index: number, patch: Partial<ZapPreset>): void => {
    const next = presets.map((preset, i) => (i === index ? { ...preset, ...patch } : preset))
    writePresets(next)
  }

  const current = presets[editIndex]

  return (
    <dialog
      /* Focusable so `openModal` can put the initial focus HERE rather than on the ✕. */
      tabIndex={-1}
      ref={ref}
      onClose={onClose}
      onClick={clickEvent => {
        if (clickEvent.target === ref.current) onClose()
      }}
      className="zap-panel m-auto w-[min(364px,calc(100vw-2rem))] rounded-[22px] border border-border bg-bg-elevated p-5 text-text shadow-xl backdrop:bg-overlay backdrop:backdrop-blur-[3px]"
    >
      <div className="mb-4 flex items-center">
        <h2 className="text-[19px] font-extrabold tracking-[-0.02em]">Zap</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto flex size-8 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[17px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M6 6 18 18M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <Avatar pubkey={recipient} name={name} picture={profile?.picture} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-bold text-text">{name}</p>
          <p className="truncate text-sm text-text-muted">
            {profile?.lud16 ?? `${npubOf(recipient).slice(0, 20)}…`}
          </p>
        </div>
      </div>

      {!canReceive ? (
        <p className="mt-4 rounded-lg border border-border bg-bg-inset px-3 py-3 text-sm text-text-muted">
          {name} has no lightning address in their profile, so there is nowhere to send sats.
          Nothing here can work around that, they have to add one.
        </p>
      ) : !canPay ? (
        <p className="mt-4 rounded-lg border border-border bg-bg-inset px-3 py-3 text-sm text-text-muted">
          No wallet is connected.{' '}
          <Link href="/zaps?tab=wallet" className="underline decoration-border-strong underline-offset-2">
            Connect one
          </Link>{' '}
          and zapping works everywhere in the app.
        </p>
      ) : (
        <>
          <div className="mt-5 flex items-baseline justify-between">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.11em] text-text-muted">
              Amount
            </p>
            <button
              type="button"
              aria-pressed={editing}
              onClick={() => setEditing(value => !value)}
              className="cursor-pointer pb-2 pl-2 text-[10px] font-bold uppercase tracking-[0.11em] text-zap-icon hover:brightness-110"
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>

          <div className={`grid grid-cols-3 gap-2 ${editing ? 'zap-grid-editing' : ''}`}>
            {presets.map((preset, index) => {
              const chosen = editing ? index === editIndex : custom.trim() === '' && sats === preset.sats
              return (
                <button
                  key={`${preset.sats}-${index}`}
                  type="button"
                  title={preset.name === undefined ? `${preset.sats.toLocaleString()} sats` : `${preset.name} · ${preset.sats.toLocaleString()} sats`}
                  aria-label={`${preset.name ?? 'Amount'}, ${preset.sats.toLocaleString()} sats`}
                  onClick={() => {
                    if (editing) {
                      setEditIndex(index)
                      return
                    }
                    setSats(preset.sats)
                    setCustom('')
                  }}
                  className={`zap-tile flex cursor-pointer items-center justify-center gap-1.5 rounded-[14px] border bg-bg-inset px-1.5 py-2.5 transition-[background,border-color,transform] active:scale-95 ${
                    chosen ? 'border-text' : 'border-transparent'
                  }`}
                >
                  {preset.label === undefined ? null : (
                    <span aria-hidden="true" className="text-sm leading-none">
                      {preset.label}
                    </span>
                  )}
                  <span className="text-[13.5px] font-bold tracking-[-0.03em] tabular-nums">
                    {formatCount(preset.sats)}
                  </span>
                  <span className="text-[10px] text-text-muted">sats</span>
                </button>
              )
            })}
          </div>

          {editing && current !== undefined ? (
            <div className="mt-2.5 rounded-[15px] border border-border bg-bg-inset p-3">
              <div className="mb-2.5 grid grid-cols-7 gap-1.5">
                {EMOJI.map(glyph => (
                  <button
                    key={glyph}
                    type="button"
                    onClick={() => editPreset(editIndex, { label: glyph })}
                    className="cursor-pointer rounded-[10px] border border-transparent bg-bg py-1.5 text-[15px] leading-none transition-transform hover:border-zap-border hover:bg-zap-surface active:scale-90"
                  >
                    {glyph}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  aria-label="Template emoji"
                  maxLength={4}
                  value={current.label ?? ''}
                  onChange={changeEvent => editPreset(editIndex, { label: changeEvent.target.value })}
                  className="w-14 rounded-xl border border-border bg-bg px-2 py-2 text-center text-base text-text focus:border-zap-icon focus:outline-none"
                />
                <input
                  aria-label="Template amount in sats"
                  inputMode="numeric"
                  value={String(current.sats)}
                  onChange={changeEvent => {
                    const value = Number(changeEvent.target.value.replace(/[^0-9]/g, ''))
                    if (Number.isInteger(value) && value > 0) editPreset(editIndex, { sats: Math.min(10_000_000, value) })
                  }}
                  className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-2 text-[16px] font-semibold tabular-nums text-text focus:border-zap-icon focus:outline-none"
                />
                <span className="text-xs text-text-muted">sats</span>
              </div>
              <input
                aria-label="Template label"
                maxLength={14}
                placeholder="label"
                value={current.name ?? ''}
                onChange={changeEvent => editPreset(editIndex, { name: changeEvent.target.value })}
                className="mt-2 w-full rounded-xl border border-border bg-bg px-3 py-2 text-[16px] text-text placeholder:text-text-faint focus:border-zap-icon focus:outline-none"
              />
              <button
                type="button"
                onClick={() => writePresets(DEFAULT_ZAP_PRESETS)}
                className="mx-auto mt-3 block cursor-pointer p-0.5 text-[10.5px] text-text-muted underline underline-offset-2 hover:text-text"
              >
                Reset all templates
              </button>
            </div>
          ) : null}

          {editing ? null : (
            <>
              <div className="mt-4 flex items-center gap-2">
                <span className="shrink-0 text-[13px] tracking-[-0.01em] text-text-muted">
                  Custom amount
                </span>
                <input
                  aria-label="Custom amount in sats"
                  inputMode="numeric"
                  value={custom}
                  onChange={changeEvent => setCustom(changeEvent.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={keyEvent => {
                    if (keyEvent.key === 'Enter') {
                      keyEvent.preventDefault()
                      void send()
                    }
                  }}
                  placeholder={String(sats)}
                  className="min-w-0 flex-1 rounded-xl border border-border bg-bg-inset px-3 py-2.5 text-[16px] font-semibold tabular-nums text-text placeholder:font-normal placeholder:text-text-faint focus:border-zap-icon focus:outline-none"
                />
                <span className="text-xs text-text-muted">sats</span>
              </div>

              <div className="my-4 h-px bg-border" />

              <input
                aria-label="Zap note"
                maxLength={120}
                value={comment}
                onChange={changeEvent => setComment(changeEvent.target.value)}
                onKeyDown={keyEvent => {
                  if (keyEvent.key === 'Enter') {
                    keyEvent.preventDefault()
                    void send()
                  }
                }}
                placeholder="Add emoji or text"
                className="w-full rounded-xl border border-border bg-bg-inset px-3 py-2.5 text-[16px] text-text placeholder:text-text-faint focus:border-zap-icon focus:outline-none"
              />
              <div className="mt-2 grid grid-cols-7 gap-1.5">
                {EMOJI.map(glyph => (
                  <button
                    key={glyph}
                    type="button"
                    onClick={() => setComment(value => `${value}${value === '' || /\s$/u.test(value) ? '' : ' '}${glyph}`.slice(0, 120))}
                    className="cursor-pointer rounded-[10px] border border-transparent bg-bg-inset py-1.5 text-[15px] leading-none transition-transform hover:border-zap-border hover:bg-zap-surface active:scale-90"
                  >
                    {glyph}
                  </button>
                ))}
              </div>

              {warning !== undefined ? <p className="mt-3 text-xs text-text-muted">{warning}</p> : null}
              {error !== undefined ? (
                <p role="alert" className="mt-3 text-sm text-danger-text">
                  {error}
                </p>
              ) : null}

              <button
                ref={commit}
                type="button"
                disabled={!amountValid || stage === 'paying' || stage === 'done'}
                onClick={send}
                className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[14px] bg-text py-3.5 text-[14.5px] font-bold tracking-[-0.01em] text-bg shadow-md transition-[background,transform] hover:opacity-90 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stage === 'done' ? (
                  'Sent'
                ) : stage === 'paying' ? (
                  // "Paying" is the plumbing's word.
                  'Zapping…'
                ) : (
                  <>
                    <InteractionIcon name="zap" size={17} filled />
                    Zap <b className="tabular-nums">{amountValid ? amount.toLocaleString() : ', '}</b> sats
                  </>
                )}
              </button>

              {/* Only when it needs saying. */}
              {connection === undefined ? (
                <p className="mt-3 text-center text-xs text-text-faint">
                  Paid by your browser extension.
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </dialog>
  )
}

