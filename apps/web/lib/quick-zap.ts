'use client'

import { useCallback } from 'react'
import type { Hex, NostrEvent, Signer } from '@nostrich/nostr'

import { announceZapFailure } from './outcome'
import { addPendingZap, settlePendingZap } from './zap-store'
import { useProfile } from './profiles'
import { canReceiveZaps, sendZap } from './zap-send'
import { hasWebln, knownInsufficient, useDefaultZap, useNwcClient, useWallet } from './wallet'

/** One tap on the bolt, and the rules for when a tap is not enough. */
export function useQuickZap({
  viewer,
  recipient,
  event,
  signer,
  onZapped,
  openDialog,
}: {
  /** Who is paying. */
  viewer: Hex | undefined
  recipient: Hex
  /** Set when zapping a note. */
  event?: NostrEvent
  signer: Signer | undefined
  /** Called with the amount once a payment succeeds, so the caller can light its bolt. */
  onZapped?: (sats: number) => void
  /** The modal. */
  openDialog: (outcome?: { error?: string; notice?: string }) => void
}): () => Promise<number | undefined> {
  const profile = useProfile(recipient)
  const client = useNwcClient(viewer)
  // The wallet's identity, so a cached balance from a PREVIOUS wallet cannot refuse.
  const walletPubkey = useWallet(viewer).connection?.walletPubkey
  const [defaultZap] = useDefaultZap()

  return useCallback(async (): Promise<number | undefined> => {
    if (signer === undefined || profile === null || !canReceiveZaps(profile)) {
      openDialog()
      return undefined
    }
    if (client === undefined && !hasWebln()) {
      openDialog()
      return undefined
    }

    /** THE BOLT LIGHTS NOW. */
    /* THE ONE CHECK WORTH MAKING, and it happens before anything is sent. */
    if (knownInsufficient(defaultZap, walletPubkey)) {
      announceZapFailure(
        `Not enough sats in your wallet to zap ${defaultZap.toLocaleString()}.`,
      )
      return undefined
    }

    onZapped?.(defaultZap)

    /* On the strip immediately, in whichever slot the amount earns. */
    const optimistic =
      event === undefined || viewer === undefined
        ? undefined
        : addPendingZap(event.id, {
            sender: viewer,
            sats: defaultZap,
            at: Math.floor(Date.now() / 1000),
          })

    void sendZap({
      recipient,
      profile,
      ...(event === undefined ? {} : { event }),
      amountSats: defaultZap,
      signer,
      client,
    }).then(result => {
      // A failure takes the optimistic entry back off the strip.
      if (optimistic !== undefined && event !== undefined) {
        settlePendingZap(event.id, optimistic, result.ok)
      }
      /* NOTHING IS SAID WHEN IT FAILS, and that is deliberate. */
    })

    return defaultZap
  }, [client, defaultZap, event, onZapped, openDialog, profile, recipient, signer])
}
