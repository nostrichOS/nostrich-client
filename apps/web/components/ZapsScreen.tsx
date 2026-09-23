'use client'

import { Link } from './AppLink'
import { useEffect, useMemo, useState } from 'react'
import { profileDisplayName, type NwcBalance } from '@nostrich/nostr'

import { npubOf, relativeTime } from '../lib/format'
import { formatCount } from '../lib/fx/count'
import { useTabParam } from '../lib/tab-param'
import { useProfileZaps } from '../lib/profile-zaps'
import { paidByZap, unzappedIncome, useWalletLedger, type WalletPayment } from '../lib/wallet-ledger'
import { isZapPayment, newZapsFromWallet, zapEntriesFromPayments } from '../lib/wallet-zaps'
import { ZapBanner } from './ZapBanner'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { COLUMN_ROW, PAGE, PAGE_TITLE, SCALED_BODY, TAB_ACTIVE, TAB_CELL, TAB_IDLE, TAB_LABEL, TAB_STRIP, TAB_STRIP_BLEED, TAB_STRIP_ROW, TAB_UNDERLINE } from '../lib/styles'
import { DEFAULT_ZAP_PRESETS, MAX_ZAP_PRESETS, connectWallet, disconnectWallet, hasWebln, providerLabel, type ZapPreset, useDefaultZap, useNwcClient, useWallet, useWalletAlias, useWalletBalance, useZapPresets, useWalletBudget } from '../lib/wallet'
import { Avatar } from './Avatar'
import { useNowSeconds } from './Clock'
import { EmojiPicker } from './EmojiPicker'
import { InteractionIcon } from './InteractionIcon'
import { ZapAddressOffer } from './ZapAddressOffer'
import { useDestination } from '../lib/zap-address'
import { VerifiedBadge } from './VerifiedBadge'
import { useNewestZapAt, useZapsSeen, useZapsUnread } from '../lib/notifications'
import { sessionPubkey, useSession } from './SessionProvider'

/** The wallet screen. */

type TabId = 'wallet' | 'received' | 'sent'

/** Wallet first, and it is the default. */
/** No faces on the wallet card: a balance has no people behind. */
const EMPTY_ENTRIES: readonly [] = []

/** THE ZAP MODAL'S VOCABULARY, borrowed wholesale. */
const MICRO_HEADING = 'text-[10px] font-bold uppercase tracking-[0.11em] text-text-muted'
const PANEL = 'rounded-[15px] border border-border bg-bg-inset p-3'
/* 16px, NOT `text-sm`. */
const FIELD =
  'w-full rounded-xl border border-border bg-bg-inset px-3 py-2.5 text-[16px] text-text placeholder:text-text-faint focus:outline-none'
const PRIMARY =
  'w-full cursor-pointer rounded-[14px] bg-text py-3.5 text-[14.5px] font-bold tracking-[-0.01em] text-bg shadow-md transition-[background,transform] hover:opacity-90 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50'
const SECONDARY =
  'cursor-pointer rounded-[14px] border border-border px-4 py-2.5 text-[13.5px] font-semibold text-text-muted transition-colors hover:bg-bg-inset hover:text-text'
/** The Edit/Done affordance, in the zap colour, exactly as the modal draws. */
const MICRO_ACTION =
  'cursor-pointer text-[10px] font-bold uppercase tracking-[0.11em] text-zap-icon hover:brightness-110'

const TABS: { id: TabId; label: string }[] = [
  { id: 'wallet', label: 'Wallet' },
  { id: 'received', label: 'Received' },
  { id: 'sent', label: 'Sent' },
]

export function ZapsScreen(): React.ReactNode {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)

  /** Opening the page IS reading. */
  const newestZapAt = useNewestZapAt(pubkey)
  const { markSeen: markZapsSeen } = useZapsSeen()
  const [tab, setTab] = useTabParam<TabId>(['wallet', 'received', 'sent'], 'wallet')
  /** READING RECEIVED IS WHAT MARKS ZAPS READ. */
  useEffect(() => {
    if (tab === 'received' && newestZapAt > 0) markZapsSeen(newestZapAt)
  }, [tab, newestZapAt, markZapsSeen])
  /** Same source as the bolt in the rail, so the two cannot disagree. */
  const zapsUnread = useZapsUnread(pubkey)

  if (pubkey === undefined) {
    return (
      <div className={PAGE}>
        <h1 className={PAGE_TITLE}>Wallet</h1>
        <p className={`mt-4 ${SCALED_BODY} text-text-muted`}>
          <Link href="/login" className="underline decoration-border-strong underline-offset-2">
            Sign in
          </Link>{' '}
          to connect a wallet. Zaps are lightning payments signed with your key, so they need
          one.
        </p>
      </div>
    )
  }

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Wallet</h1>

      <div className={`mt-4 ${TAB_STRIP} ${TAB_STRIP_BLEED}`}>
        <div role="tablist" aria-label="Wallet" className={TAB_STRIP_ROW}>
          {TABS.map(item => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={TAB_CELL}
            >
              <span className={TAB_LABEL}>
                <span className={tab === item.id ? TAB_ACTIVE : TAB_IDLE}>
                  {item.label}
                </span>
                {/* Sats arrived and have not been looked. */}
                {item.id === 'received' && zapsUnread > 0 ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="ml-1.5 size-2 shrink-0 rounded-full bg-[#f97315]"
                    />
                    <span className="sr-only">
                      {zapsUnread} new {zapsUnread === 1 ? 'zap' : 'zaps'}
                    </span>
                  </>
                ) : null}
                {tab === item.id ? (
                  <span aria-hidden="true" className={TAB_UNDERLINE} />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'wallet' ? <WalletTab /> : tab === 'sent' ? <SentTab /> : <ReceivedTab />}
    </div>
  )
}

function WalletTab(): React.ReactNode {
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const signer = session.status === 'signed' ? session.signer : undefined
  const profile = useProfile(viewer)
  // Per ACCOUNT, not per browser: see the note on `KEY_PREFIX` in lib/wallet.ts.
  const { connection } = useWallet(viewer)
  const client = useNwcClient(viewer)
  const [defaultZap, setDefaultZap] = useDefaultZap()

  const [uri, setUri] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  // Cached on disk and refreshed behind whatever is on screen.
  const { balanceMsat, loading: checkingBalance, stale: balanceStale } = useWalletBalance(viewer)
  /* The allowance on this connection, when the wallet reports one. */
  const budget = useWalletBudget(viewer)

  /** What this wallet is called, and WHERE PEOPLE PAY. */
  const destination = useDestination(connection?.lud16, profile?.lud16)

  /* Asked once per connection: a balance is a live figure and re-polling. */
  /** The alias only. */
  /* Now a cached query rather than a bare effect. */
  const walletName = useWalletAlias(viewer)

  if (connection === undefined) {
    return (
      <div className="mt-5">
        <h2 className={MICRO_HEADING}>Connect a wallet</h2>
        {/* The named wallets have to be alive, and two of the three. */}
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          Paste a Nostr Wallet Connect string from Alby Hub, Zeus, Coinos, LNbits, or your own
          node to enable zapping across the entire app.
        </p>

        <label htmlFor="nwc" className="sr-only">
          Nostr Wallet Connect string
        </label>
        <input
          id="nwc"
          value={uri}
          onChange={changeEvent => {
            setUri(changeEvent.target.value)
            setError(undefined)
          }}
          // A connection string is a secret.
          type="password"
          placeholder="nostr+walletconnect://…"
          /* No accent border on focus. */
          className={`mt-3 font-mono ${FIELD}`}
        />
        {error !== undefined ? (
          <p role="alert" className="mt-2 text-sm text-danger-text">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={uri.trim() === ''}
          onClick={() => {
            const result = connectWallet(viewer, uri)
            if (result.ok) setUri('')
            else setError(result.message)
          }}
          className={`mt-3 ${PRIMARY}`}
        >
          Connect
        </button>

        {/* Said before connecting, not in a settings page afterwards. */}
        <p className={`mt-4 text-xs leading-relaxed text-text-muted ${PANEL}`}>
          Your connection string stays in your browser and is never sent to any servers. Your
          wallet never touches Nostrich&rsquo;s infrastructure. Spending is limited by the
          budget you set in your wallet, so make sure one is configured.
        </p>

        {hasWebln() ? (
          <p className="mt-3 text-xs text-text-muted">
            A lightning extension is also available in this browser and will be used if you do
            not connect a wallet here.
          </p>
        ) : null}

        <DefaultAmount value={defaultZap} onChange={setDefaultZap} />
      </div>
    )
  }

  /** WHERE PEOPLE PAY THIS WALLET. */
  /* The address WAITS. */
  const label = walletName ?? providerLabel(connection.lud16)
  const receiving =
    destination === 'pending'
      ? undefined
      : destination === 'same' && profile?.lud16 !== undefined
        ? profile.lud16
        : (connection.lud16 ?? `${connection.walletPubkey.slice(0, 12)}…`)
  const walletCaption = [label, receiving].filter(part => part !== undefined).join(' · ')

  return (
    <div className="mt-5">
      {/* The same card as Received and Sent, in the zap colour. */}
      <ZapBanner
        tone="wallet"
        sats={balanceMsat === undefined ? 0 : Math.floor(balanceMsat / 1000)}
        {...(balanceMsat === undefined ? { figure: 'Unavailable' } : {})}
        /* SAYS SO WHEN THE WALLET HAS NOT ANSWERED. */
        /* WHAT THE NUMBER ACTUALLY. */
        {...(balanceStale
          ? { caption: 'Last known, your wallet has not answered yet' }
          : budget !== undefined &&
              balanceMsat !== undefined &&
              balanceMsat <= budget.totalMsat - budget.usedMsat
            ? {
                caption: `limited by this connection's ${Math.floor(budget.totalMsat / 1000).toLocaleString()} sat budget`,
              }
            : {})}
        count={0}
        entries={EMPTY_ENTRIES}
        // The skeleton bar, for as long as the wallet has not answered.
        loading={balanceMsat === undefined && checkingBalance}
        /* THE ADDRESS, not the pubkey. */
        caption={<span className="truncate">{walletCaption}</span>}
      />

      <div>
        <button
          type="button"
          onClick={() => disconnectWallet(viewer)}
          className={`mt-4 ${SECONDARY}`}
        >
          Disconnect
        </button>
      </div>

      <ZapAddressOffer
        pubkey={viewer}
        signer={signer}
        walletName={walletName}
        walletAddress={connection.lud16}
        currentAddress={profile?.lud16}
      />

      <DefaultAmount value={defaultZap} onChange={setDefaultZap} />

    </div>
  )
}

function DefaultAmount({
  value,
  onChange,
}: {
  value: number
  onChange: (sats: number) => void
}): React.ReactNode {
  const [presets, setPresets] = useZapPresets()
  const [editing, setEditing] = useState(false)

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={MICRO_HEADING}>Zap amounts</h2>
        <button type="button" onClick={() => setEditing(open => !open)} className={MICRO_ACTION}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      <p className="mb-3 mt-1.5 text-xs text-text-faint">
        Set your predefined zap amounts. The highlighted amount is the default, and choosing a
        different amount makes it the new default.
      </p>

      {editing ? (
        <PresetEditor presets={presets} onChange={setPresets} />
      ) : (
        /* The modal's grid, to the pixel: three columns of 14px tiles, the chosen one. */
        <div className="grid grid-cols-3 gap-2">
          {presets.map(preset => (
            <button
              key={preset.sats}
              type="button"
              aria-pressed={value === preset.sats}
              title={
                preset.name === undefined
                  ? `${preset.sats.toLocaleString()} sats`
                  : `${preset.name} · ${preset.sats.toLocaleString()} sats`
              }
              onClick={() => onChange(preset.sats)}
              /* The default is RAISED, not just outlined: same border as the modal's chosen tile. */
              className={`zap-tile flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[14px] border px-1.5 py-2 transition-[background,border-color,transform] active:scale-95 ${
                value === preset.sats
                  ? 'border-text bg-bg shadow-sm'
                  : 'border-transparent bg-bg-inset'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                {preset.label !== undefined ? (
                  <span aria-hidden="true" className="text-sm leading-none">
                    {preset.label}
                  </span>
                ) : null}
                <span className="text-[13.5px] font-bold tracking-[-0.03em] tabular-nums">
                  {formatCount(preset.sats)}
                </span>
                <span className="text-[10px] text-text-muted">sats</span>
              </span>
              {/* ONE word, on ONE tile. */}
              <span
                className="text-[9px] font-bold uppercase leading-none tracking-[0.09em] text-zap-icon"
              >
                {value === preset.sats ? 'default' : '\u00a0'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Editing the amounts. */
/** Characters a label may hold. */
const MAX_LABEL = 16

function PresetEditor({
  presets,
  onChange,
}: {
  presets: ZapPreset[]
  onChange: (next: ZapPreset[]) => void
}): React.ReactNode {
  const [picking, setPicking] = useState<number | null>(null)

  const update = (index: number, patch: Partial<ZapPreset>): void => {
    const next = presets.map((preset, i) => (i === index ? { ...preset, ...patch } : preset))
    onChange(next.filter(preset => Number.isInteger(preset.sats) && preset.sats > 0))
  }

  return (
    <div className="space-y-2">
      {presets.map((preset, index) => (
        <div key={index} className="flex items-center gap-2">
          {/* A text field AND the picker, not one or the other. */}
          <div className="relative flex items-center gap-1">
            <input
              aria-label="Label"
              value={preset.label ?? ''}
              onChange={event => update(index, { label: event.target.value.slice(0, MAX_LABEL) })}
              placeholder="⚡ tip"
              className="w-28 rounded-lg border border-border bg-bg px-2.5 py-2 text-[16px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              aria-label={`Add an emoji to the ${preset.sats} sats label`}
              onClick={() => setPicking(picking === index ? null : index)}
              className={`flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors ${
                picking === index ? 'border-text bg-bg-inset' : 'border-border hover:bg-bg-inset'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]! text-text-faint" aria-hidden="true">
                add_reaction
              </span>
            </button>
            {picking === index ? (
              <EmojiPicker
                onPick={emoji => {
                  // Appended, and capped: a label longer than its button is a label nobody can read.
                  update(index, { label: `${preset.label ?? ''}${emoji}`.slice(0, MAX_LABEL) })
                  setPicking(null)
                }}
                onClose={() => setPicking(null)}
              />
            ) : null}
          </div>

          <input
            aria-label="Sats"
            inputMode="numeric"
            value={String(preset.sats)}
            onChange={event => {
              const sats = Number(event.target.value.replace(/[^0-9]/g, ''))
              if (Number.isInteger(sats) && sats > 0) update(index, { sats })
            }}
            className="w-28 rounded-lg border border-border bg-bg px-3 py-2 text-[16px] text-text focus:border-accent focus:outline-none"
          />
          <span className="text-xs text-text-faint">sats</span>
          {preset.label !== undefined && preset.label !== '' ? (
            <button
              type="button"
              aria-label={`Remove the icon on ${preset.sats} sats`}
              onClick={() => update(index, { label: '' })}
              className="cursor-pointer text-xs text-text-faint underline decoration-border-strong underline-offset-2 hover:text-text"
            >
              clear
            </button>
          ) : null}
          <button
            type="button"
            aria-label={`Remove ${preset.sats} sats`}
            disabled={presets.length <= 1}
            onClick={() => onChange(presets.filter((_, i) => i !== index))}
            className="ml-auto cursor-pointer rounded-lg p-1.5 text-text-faint transition-colors hover:bg-bg-inset hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
              close
            </span>
          </button>
        </div>
      ))}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={presets.length >= MAX_ZAP_PRESETS}
          onClick={() => onChange([...presets, { sats: 1_000 }])}
          // Greyed at the cap rather than removed: a control that vanishes reads as a bug.
          className={`${SECONDARY} text-text disabled:cursor-not-allowed disabled:opacity-40`}
        >
          Add custom amount
        </button>
        <button
          type="button"
          onClick={() => onChange([...DEFAULT_ZAP_PRESETS])}
          className={SECONDARY}
        >
          Reset
        </button>
      </div>
    </div>
  )
}

/** Zaps received, read from relays rather than from the wallet. */
/** The running total, and it is drawn EVEN AT ZERO. */
/** What a money screen says when it does not know. */
function ZapsUnreachable({ retry }: { retry: () => void }): React.ReactNode {
  return (
    <div className="mt-5 rounded-lg border border-border bg-bg-inset px-5 py-6 text-center">
      <p className="text-sm leading-relaxed text-text-muted">
        Could not reach the relays that hold your zap receipts, so there is no total to show.
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-3 rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-text hover:border-accent hover:text-accent"
      >
        Try again
      </button>
    </div>
  )
}

function ReceivedTab(): React.ReactNode {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const profile = useProfile(pubkey)
  /** The same paged source the profile's Zaps tab uses. */
  // Always active: this component only mounts when the Received tab is the one being.
  const zaps = useProfileZaps(pubkey, profile, true)
  /** EVERYTHING RECEIVED, not only what Nostr can see. */
  const ledger = useWalletLedger(pubkey, true)
  const unmatched = useMemo(() => unzappedIncome(ledger, zaps.received), [ledger, zaps.received])

  /** A ZAP THE RELAYS NEVER ANNOUNCED IS STILL A ZAP. */
  const walletZaps = useMemo(
    () => newZapsFromWallet(zaps.received, zapEntriesFromPayments(unmatched)),
    [unmatched, zaps.received],
  )
  /** What is left really is anonymous income. */
  const other = useMemo(() => unmatched.filter(payment => !isZapPayment(payment)), [unmatched])
  const otherSats = useMemo(() => other.reduce((sum, payment) => sum + payment.sats, 0), [other])
  const walletZapSats = useMemo(() => walletZaps.reduce((sum, zap) => sum + zap.sats, 0), [walletZaps])
  /** Relay-announced zaps and wallet-proven ones, as one list. */
  const allZaps = useMemo(
    () => [...zaps.received, ...walletZaps].sort((a, b) => b.createdAt - a.createdAt),
    [walletZaps, zaps.received],
  )

  /** One column, newest first, whichever ledger a row came. */
  const rows = useMemo(
    () =>
      [
        ...allZaps.map(zap => ({ at: zap.createdAt, zap, payment: undefined })),
        ...other.map(payment => ({ at: payment.at, zap: undefined, payment })),
      ].sort((a, b) => b.at - a.at),
    [allZaps, other],
  )

  /* The zap half being unavailable does not make the wallet half disappear. */
  if (zaps.failed) {
    return (
      <>
        <ZapsUnreachable retry={zaps.retry} />
        {other.length === 0 ? null : (
          <ul className="mt-2">
            {other.map(payment => (
              <PaymentRow key={payment.id} payment={payment} />
            ))}
          </ul>
        )}
      </>
    )
  }

  /* `rows.length === 0` as well, because this message is about LIGHTNING and there. */
  if (zaps.unverifiable && other.length === 0 && rows.length === 0) {
    return (
      <p className="mt-5 text-sm leading-relaxed text-text-muted">
        Your profile has no lightning address, so there is nothing to check a receipt against , 
        a zap receipt is signed by a lightning server, and without one any of them could be
        forged. Add one to your profile and received zaps appear here.
      </p>
    )
  }

  const loading = zaps.loading && rows.length === 0

  return (
    <>
      <div className="mt-5">
        <ZapBanner
          tone="in"
          sats={zaps.receivedSats + walletZapSats + otherSats}
          count={(zaps.receivedCount ?? zaps.received.length) + walletZaps.length}
          partial={zaps.receivedCount !== undefined && zaps.receivedCount > zaps.received.length}
          entries={allZaps}
          loading={loading}
          {...(other.length === 0
            ? {}
            : {
                // The pill has to account for the figure above.
                caption: (
                  <>
                    across{' '}
                    <strong>
                      {((zaps.receivedCount ?? zaps.received.length) + walletZaps.length).toLocaleString()}
                    </strong>{' '}
                    {allZaps.length === 1 ? 'zap' : 'zaps'} ·{' '}
                    <strong>{other.length.toLocaleString()}</strong>{' '}
                    {other.length === 1 ? 'payment' : 'payments'}
                  </>
                ),
              })}
        />
      </div>
      {/* WHEN THE WALLET CANNOT TELL US, SAY. */}
      {ledger.connected && !ledger.supported ? (
        <p className="mt-3 text-center text-xs text-text-faint">
          Your wallet does not report its payment history, so only zaps are listed here.
          Anything that was not a zap is still in the wallet itself.
        </p>
      ) : null}
      {loading ? (
        <ZapRowsSkeleton />
      ) : rows.length === 0 ? (
        <p className="mt-6 text-center text-sm text-text-muted">Nothing received yet.</p>
      ) : (
        <ul className="mt-2">
          {rows.map(row =>
            row.zap !== undefined ? (
              <ReceivedRow
                key={row.zap.id}
                pubkey={row.zap.counterparty}
                sats={row.zap.sats}
                comment={row.zap.comment}
                at={row.zap.createdAt}
                targetId={row.zap.eventId}
              />
            ) : (
              <PaymentRow key={row.payment.id} payment={row.payment} />
            ),
          )}
        </ul>
      )}
    </>
  )
}

/** A payment that is not a zap, in either direction. */
function PaymentRow({ payment }: { payment: WalletPayment }): React.ReactNode {
  const now = useNowSeconds()
  return (
    <li className={`flex gap-3 border-b border-border py-4 ${COLUMN_ROW}`}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zap-surface text-zap-icon">
        <InteractionIcon name="zap" size={19} filled />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-bold text-text">
            Lightning payment
          </span>
          <span aria-hidden="true" className="shrink-0 text-text-faint">
            ·
          </span>
          <span className="shrink-0 text-sm text-text-faint">
            {now === 0 || payment.at === 0 ? '' : relativeTime(payment.at, now)}
          </span>
        </span>
        {/* Whatever was written on the invoice. */}
        {payment.description === undefined ? (
          <span className={`mt-0.5 block ${SCALED_BODY} text-text-muted`}>
            {payment.incoming
              ? 'Received by your connected wallet, not through a zap.'
              : 'Paid from your connected wallet, not as a zap.'}
          </span>
        ) : (
          <span className={`mt-0.5 block break-words ${SCALED_BODY} text-text`}>
            {payment.description}
          </span>
        )}
      </span>
      <span
        className={`shrink-0 pt-0.5 text-sm font-bold tabular-nums ${
          payment.incoming ? 'text-success-text' : 'text-text'
        }`}
      >
        {payment.incoming ? '+' : '−'}
        {payment.sats.toLocaleString()}
      </span>
    </li>
  )
}

/** Twelve rows, enough to reach the bottom of a phone screen. */
function ZapRowsSkeleton(): React.ReactNode {
  return (
    <ul className="mt-4" aria-hidden="true">
      {Array.from({ length: 12 }, (_, row) => (
        <li key={row} className={`flex gap-3 border-b border-border py-4 ${COLUMN_ROW}`}>
          <div className="size-9 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-32 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
            <div className="h-3 w-20 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function SentTab(): React.ReactNode {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const profile = useProfile(pubkey)
  // Always active: this component only mounts when the Sent tab is the one being shown.
  const zaps = useProfileZaps(pubkey, profile, true)
  /** EVERYTHING SENT. */
  const ledger = useWalletLedger(pubkey, true)
  const other = useMemo(
    () => ledger.outgoing.filter(payment => !paidByZap(payment, zaps.sent)),
    [ledger.outgoing, zaps.sent],
  )
  const otherSats = useMemo(() => other.reduce((sum, payment) => sum + payment.sats, 0), [other])

  const rows = useMemo(
    () =>
      [
        ...zaps.sent.map(zap => ({ at: zap.createdAt, zap, payment: undefined })),
        ...other.map(payment => ({ at: payment.at, zap: undefined, payment })),
      ].sort((a, b) => b.at - a.at),
    [zaps.sent, other],
  )

  // The zap half being unreachable does not take the wallet half.
  if (zaps.failed) {
    return (
      <>
        <ZapsUnreachable retry={zaps.retry} />
        {other.length === 0 ? null : (
          <ul className="mt-2">
            {other.map(payment => (
              <PaymentRow key={payment.id} payment={payment} />
            ))}
          </ul>
        )}
      </>
    )
  }

  const loading = zaps.loading && rows.length === 0

  return (
    <>
      <div className="mt-5">
        <ZapBanner
          tone="out"
          sats={zaps.sentSats + otherSats}
          count={zaps.sentCount ?? zaps.sent.length}
          partial={zaps.sentCount !== undefined && zaps.sentCount > zaps.sent.length}
          entries={zaps.sent}
          loading={loading}
          {...(other.length === 0
            ? {}
            : {
                caption: (
                  <>
                    across <strong>{(zaps.sentCount ?? zaps.sent.length).toLocaleString()}</strong>{' '}
                    {zaps.sent.length === 1 ? 'zap' : 'zaps'} ·{' '}
                    <strong>{other.length.toLocaleString()}</strong>{' '}
                    {other.length === 1 ? 'payment' : 'payments'}
                  </>
                ),
              })}
        />
      </div>
      {loading ? (
        <ZapRowsSkeleton />
      ) : rows.length === 0 ? (
        /* The `#P` caveat this used to explain. */
        <p className="mt-6 text-center text-sm leading-relaxed text-text-muted">
          Nothing sent yet. Connect your wallet to start zapping.
        </p>
      ) : (
        <ul className="mt-2">
          {rows.map(row =>
            row.zap !== undefined ? (
              <ReceivedRow
                key={row.zap.id}
                pubkey={row.zap.counterparty}
                sats={row.zap.sats}
                comment={row.zap.comment}
                at={row.zap.createdAt}
                targetId={row.zap.eventId}
                outgoing
              />
            ) : (
              <PaymentRow key={row.payment.id} payment={row.payment} />
            ),
          )}
        </ul>
      )}
    </>
  )
}

function ReceivedRow({
  pubkey,
  sats,
  comment,
  at,
  targetId,
  outgoing = false,
}: {
  pubkey: string
  sats: number
  comment?: string
  at: number
  targetId?: string
  /** Sent rather than received: the same row, read the other way round. */
  outgoing?: boolean
}): React.ReactNode {
  const profile = useProfile(pubkey)
  const verified = useNip05Verified(profile?.nip05, pubkey)
  const now = useNowSeconds()
  const name = profileDisplayName(profile ?? { pubkey })

  const body = (
    <span className="flex gap-3 py-4">
      {/* The avatar is its own destination. */}
      <Link
        href={`/p/${npubOf(pubkey)}`}
        aria-label={`Open ${name}'s profile`}
        className="pointer-events-auto relative z-20 shrink-0 rounded-full"
      >
        <Avatar pubkey={pubkey} name={name} picture={profile?.picture} size="md" />
      </Link>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {/* A FLEX ROW, not inline text. */}
          <span className="flex min-w-0 flex-1 items-center gap-1 text-[15px] text-text">
            {outgoing ? <span className="shrink-0 text-text-muted">you zapped</span> : null}
            <span className="truncate font-semibold">{name}</span>
            {verified ? <VerifiedBadge size={15} /> : null}
            {outgoing ? null : <span className="shrink-0 text-text-muted">zapped you</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1 font-bold text-text">
            <InteractionIcon name="zap" size={15} filled />
            {sats.toLocaleString()}
          </span>
        </span>
        {comment !== undefined && comment.trim() !== '' ? (
          <span className="mt-1 line-clamp-2 text-sm leading-relaxed text-text">{comment}</span>
        ) : null}
        <span className="mt-0.5 block text-xs text-text-faint">
          {now === 0 ? null : relativeTime(at, now)}
        </span>
      </span>
    </span>
  )

  return (
    /* HOVER SPANS THE COLUMN, and the row has two destinations. */
    <li
      className={`relative -mx-4 border-b border-border transition-colors sm:-mx-5 ${
        targetId === undefined ? '' : 'hover:bg-hover'
      }`}
    >
      {targetId === undefined ? null : (
        <Link
          href={`/e/${targetId}`}
          aria-label="Open the zapped note"
          className="absolute inset-0 z-0"
        />
      )}
      <div className="pointer-events-none relative z-10 px-4 sm:px-5">{body}</div>
    </li>
  )
}
