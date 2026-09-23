'use client'

import type { Hex, Signer } from '@nostrich/nostr'

import { useZapAddressOffer } from '../lib/zap-address'

/** "Your wallet can receive too. */
export function ZapAddressOffer({
  pubkey,
  signer,
  walletName,
  walletAddress,
  currentAddress,
}: {
  pubkey: Hex | undefined
  signer: Signer | undefined
  /** From the wallet's own `get_info`, so the copy can name. */
  walletName: string | undefined
  /** From the NWC string's `lud16` parameter. */
  walletAddress: string | undefined
  currentAddress: string | undefined
}): React.ReactNode {
  const offer = useZapAddressOffer({ pubkey, signer, walletAddress, currentAddress })

  if (offer.done) {
    return (
      <p className="mt-4 rounded-lg border border-zap-border bg-zap-surface px-4 py-3 text-sm text-text">
        Zaps now go to <span className="font-mono">{walletAddress}</span>.
      </p>
    )
  }

  if (offer.address === undefined) return null

  /* Two spellings, because the name lands in two positions. */
  const walletMid = walletName ?? 'your wallet'
  const hasAddress = currentAddress !== undefined && currentAddress.trim() !== ''

  return (
    <div className="mt-4 rounded-lg border border-zap-border bg-zap-surface px-4 py-4">
      <p className="text-sm font-bold text-text">
        {hasAddress ? 'Zaps still go to your old address' : 'Nobody can zap you yet'}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-text-muted">
        {hasAddress ? (
          <>
            Your profile currently uses{' '}
            <span className="font-mono text-text">{currentAddress}</span>. Switch it to{' '}
            <span className="font-mono text-text">{offer.address}</span> to receive zaps in{' '}
            {walletMid}.
          </>
        ) : (
          <>
            Your profile has no lightning address, so there is nowhere for anyone to send sats.
            Add <span className="font-mono text-text">{offer.address}</span> to receive zaps in{' '}
            {walletMid}.
          </>
        )}
      </p>

      {offer.error === undefined ? null : (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {offer.error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={offer.busy}
          onClick={() => void offer.apply()}
          className="cursor-pointer rounded-full bg-text px-4 py-2 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {offer.busy ? 'Saving…' : 'Use this address'}
        </button>
        <button
          type="button"
          onClick={offer.dismiss}
          className="cursor-pointer rounded-full border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
        >
          Not now
        </button>
      </div>

      {/* The one thing somebody should know BEFORE pressing: this is published, and it moves. */}
      <p className="mt-3 text-xs leading-relaxed text-text-faint">
        This updates your public profile. Past zaps and zap history won&rsquo;t change.
      </p>
    </div>
  )
}
