'use client'

import { Link } from './AppLink'
import { useState } from 'react'
import { profileDisplayName } from '@nostrich/nostr'

import { npubOf, relativeTime } from '../lib/format'
import { profileHref } from '../lib/links'
import type { ProfileZaps, ZapEntry } from '../lib/profile-zaps'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { Avatar } from './Avatar'
import { ZapBanner } from './ZapBanner'
import { VerifiedBadge } from './VerifiedBadge'
import { useNowSeconds } from './Clock'
import { InteractionIcon } from './InteractionIcon'

/** Zaps in and out, on one screen. */
export function ProfileZapsTab({ zaps }: { zaps: ProfileZaps }): React.ReactNode {
  const [direction, setDirection] = useState<'received' | 'sent'>('received')
  const entries = direction === 'received' ? zaps.received : zaps.sent

  /* Before anything that states a figure. */
  if (zaps.failed) {
    return (
      <div className="px-4 py-10 text-center sm:px-5">
        <p className="text-sm leading-relaxed text-text-muted">
          Could not reach the relays that hold this account&rsquo;s zap receipts.
        </p>
        <button
          type="button"
          onClick={zaps.retry}
          className="mt-3 rounded-full border border-border px-4 py-1.5 text-sm font-semibold text-text hover:border-accent hover:text-accent"
        >
          Try again
        </button>
      </div>
    )
  }

  if (zaps.unverifiable) {
    return (
      <p className="px-4 py-10 text-center text-sm leading-relaxed text-text-muted sm:px-5">
        This account has no lightning address, so its zap receipts cannot be checked against
        anything. A receipt is signed by a lightning server, without knowing which server,
        any of them could be forged, so none are shown.
      </p>
    )
  }

  return (
    <div>
      {/* Both totals stay on screen at once: here they are also the toggle for the list. */}
      {/* One per line on a phone. */}
      <div className="grid grid-cols-1 gap-3 border-b border-border px-4 py-4 sm:grid-cols-2 sm:gap-2 sm:px-5">
        <ZapBanner
          tone="in"
          sats={zaps.receivedSats}
          /* The relays' own count where they gave one, the rows otherwise. */
          count={zaps.receivedCount ?? zaps.received.length}
          partial={zaps.receivedCount !== undefined && zaps.receivedCount > zaps.received.length}
          entries={zaps.received}
          loading={zaps.loading && zaps.received.length === 0}
          active={direction === 'received'}
          onClick={() => setDirection('received')}
        />
        <ZapBanner
          tone="out"
          sats={zaps.sentSats}
          count={zaps.sentCount ?? zaps.sent.length}
          partial={zaps.sentCount !== undefined && zaps.sentCount > zaps.sent.length}
          entries={zaps.sent}
          loading={zaps.loading && zaps.sent.length === 0}
          active={direction === 'sent'}
          onClick={() => setDirection('sent')}
        />
      </div>

      {zaps.loading && entries.length === 0 ? (
        <ul aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map(row => (
            <li key={row} className="flex gap-3 border-b border-border px-4 py-4 sm:px-5">
              <div className="size-10 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 w-32 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
                <div className="h-3 w-20 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
              </div>
            </li>
          ))}
        </ul>
      ) : entries.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm leading-relaxed text-text-muted sm:px-5">
          {direction === 'received'
            ? 'No zaps received that we can verify.'
            : 'No sent zaps found. Zaps paid through a server that does not tag the payer are invisible to every client, including this one.'}
        </p>
      ) : (
        <ul>
          {entries.map(entry => (
            <ZapRow key={entry.id} entry={entry} direction={direction} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ZapRow({
  entry,
  direction,
}: {
  entry: ZapEntry
  direction: 'received' | 'sent'
}): React.ReactNode {
  const profile = useProfile(entry.counterparty)
  const verified = useNip05Verified(profile?.nip05, entry.counterparty)
  const now = useNowSeconds()
  const name = profileDisplayName(profile ?? { pubkey: entry.counterparty })

  const body = (
    <span className="flex gap-3 px-4 py-4 sm:px-5">
      <Avatar pubkey={entry.counterparty} name={name} picture={profile?.picture} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {/* A FLEX ROW, not inline text. */}
          <span className="flex min-w-0 flex-1 items-center gap-1 text-[15px] text-text">
            <span className="truncate font-semibold">{name}</span>
            {verified ? <VerifiedBadge size={15} /> : null}
            <span className="shrink-0 text-text-muted">
              {direction === 'received' ? 'zapped' : 'was zapped'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 font-bold text-text">
            <InteractionIcon name="zap" size={14} filled />
            {entry.sats.toLocaleString()}
          </span>
        </span>

        {entry.comment !== undefined ? (
          <span className="mt-1 line-clamp-2 text-sm leading-relaxed text-text">
            {entry.comment}
          </span>
        ) : null}

        <span className="mt-0.5 flex items-center gap-2 text-xs text-text-faint">
          {now === 0 ? null : relativeTime(entry.createdAt, now)}
          {/* NO "sender unconfirmed" LABEL either. */}
        </span>
      </span>
    </span>
  )

  return (
    <li className="border-b border-border transition-colors hover:bg-bg-elevated">
      {entry.eventId !== undefined ? (
        <Link href={`/e/${entry.eventId}`} className="block">
          {body}
        </Link>
      ) : (
        <Link href={profileHref(npubOf(entry.counterparty))} className="block">
          {body}
        </Link>
      )}
    </li>
  )
}
