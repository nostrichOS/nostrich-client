'use client'

import { useState } from 'react'
import type { Hex, RelayUrl, Signer } from '@nostrich/nostr'

import { useDmRelayConcerns, useOwnDmRelays, useSaveDmRelays } from '../lib/dm-relays'

/** One line, shown only to the few people who need it, with the fix attached. */
export function DmRelayNotice({
  self,
  signer,
}: {
  self: Hex | undefined
  signer: Signer | undefined
}): React.ReactNode {
  const { list } = useOwnDmRelays(self)
  const { concerns } = useDmRelayConcerns(list?.relays)
  const save = useSaveDmRelays(signer, self)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (self === undefined || concerns.length === 0) return null

  const flagged = new Set<RelayUrl>(concerns.map(concern => concern.relay))
  const keep = (list?.relays ?? []).filter(relay => !flagged.has(relay))
  const names = concerns.map(concern => concern.relay.replace(/^wss:\/\//, '')).join(', ')

  const fix = async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    const ok = await save(keep)
    setBusy(false)
    if (!ok) setFailed(true)
  }

  return (
    <div className="mx-4 mb-2 rounded-xl bg-warning-surface px-3 py-2.5 text-[14px] leading-snug text-warning-text sm:mx-5">
      <p>
        <span
          className="material-symbols-outlined mr-1 align-[-3px] text-[16px]!"
          aria-hidden="true"
        >
          warning
        </span>
        {names} may block messages sent to you.
      </p>
      {/* Removing every relay would publish an empty list, which reads to other apps. */}
      {keep.length > 0 ? (
        <button
          type="button"
          onClick={() => void fix()}
          disabled={busy || signer === undefined}
          className="mt-1.5 cursor-pointer font-semibold underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Removing…' : 'Remove it'}
        </button>
      ) : null}
      {failed ? <p className="mt-1">Could not update. Try again.</p> : null}
    </div>
  )
}
