'use client'

import { useMemo } from 'react'
import { profileDisplayName, type Hex } from '@nostrich/nostr'

import { asset } from '../lib/assets'
import { useProfile } from '../lib/profiles'
import type { ZapEntry } from '../lib/profile-zaps'
import { Avatar } from './Avatar'
import { InteractionIcon } from './InteractionIcon'

/** The zap total, as a summary of the people behind. */

/** Faces in the pill. Three is what the design draws and what fits the narrow variant. */
const FACES = 3

export interface ZapBannerProps {
  /** `wallet` is the connected wallet's balance: same card, orange, no zap count. */
  tone: 'in' | 'out' | 'wallet'
  sats: number
  count: number
  /** The figure is a floor, not a total. */
  partial?: boolean
  /** The entries the figures were summed. */
  entries: readonly ZapEntry[]
  loading: boolean
  /** What the pill says, when it is not "across N zaps". */
  caption?: React.ReactNode
  /** Replaces the figure. For "Unavailable", which is not a number of sats. */
  figure?: React.ReactNode
  /** Button mode, for the profile's Zaps tab where the two panels are also the toggle. */
  onClick?: () => void
  active?: boolean
}

export function ZapBanner({
  tone,
  sats,
  count,
  partial = false,
  entries,
  loading,
  caption,
  figure,
  onClick,
  active,
}: ZapBannerProps): React.ReactNode {
  const inbound = tone === 'in'

  /** The most recent zappers, newest first. */
  const faces = useMemo(() => {
    const seen: Hex[] = []
    for (const entry of entries) {
      if (seen.length === FACES) break
      if (!seen.includes(entry.counterparty)) seen.push(entry.counterparty)
    }
    return seen
  }, [entries])

  const body = (
    <>
      <div
        className="zap-banner-art"
        style={{ ['--zb-art-src' as string]: `url(${asset('/zap-bolt.webp')})` }}
        aria-hidden="true"
      />
      <div className="zap-banner-body">
        <div className="zap-banner-heading">
          <span className="zap-banner-badge" aria-hidden="true">
            <InteractionIcon name="zap" size={13} filled />
          </span>
          <span className="zap-banner-title">
            {tone === 'wallet' ? 'BALANCE' : inbound ? 'RECEIVED' : 'SENT'}
          </span>
        </div>

        <p className="zap-banner-figure">
          {loading ? (
            <span
              aria-hidden="true"
              className="my-1 block h-[6cqw] min-h-6 w-[26cqw] min-w-24 animate-pulse rounded-sm bg-current opacity-10 motion-reduce:animate-none"
            />
          ) : (
            <span className="zap-banner-amount">
              {figure ?? (
                <>
                  {/* Small, and before the number, so it reads as one phrase rather than as a label. */}
                  {partial ? <span className="zap-banner-atleast">at least </span> : null}
                  {sats.toLocaleString()}
                </>
              )}
            </span>
          )}
          <span className="zap-banner-unit">sats</span>
        </p>

        <div className="zap-banner-pill">
          <span className="zap-banner-pill-icon" aria-hidden="true">
            <InteractionIcon name="zap" size={12} filled />
          </span>
          <span className="zap-banner-count">
            {caption ?? (loading ? 'counting…' : <>across <strong>{count.toLocaleString()}</strong> {count === 1 ? 'zap' : 'zaps'}</>)}
          </span>
          {faces.length === 0 ? null : (
            <span className="zap-banner-faces">
              <span
                className="zap-banner-avatars"
                aria-label={inbound ? 'Most recent zappers' : 'Most recently zapped'}
              >
                {faces.map(pubkey => (
                  <Face key={pubkey} pubkey={pubkey} />
                ))}
              </span>
            </span>
          )}
        </div>
      </div>
    </>
  )

  const tint = tone === 'wallet' ? 'zap-banner-wallet' : inbound ? 'zap-banner-in' : 'zap-banner-out'

  if (onClick === undefined) return <div className={`zap-banner ${tint}`}>{body}</div>

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      /* The unselected half is neither dimmed nor ringed. */
      className={`zap-banner ${tint} cursor-pointer text-left ${
        active === false ? 'zap-banner-idle' : ''
      }`}
    >
      {body}
    </button>
  )
}

/** One face. */
function Face({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const profile = useProfile(pubkey)
  return (
    <Avatar
      pubkey={pubkey}
      name={profileDisplayName(profile ?? { pubkey })}
      {...(profile?.picture === undefined ? {} : { picture: profile.picture })}
      size="sm"
    />
  )
}
