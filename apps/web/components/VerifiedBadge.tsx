'use client'

import { useId } from 'react'

import { BADGE_PATH } from '@nostrich/app'

import { DEFAULT_BADGE } from '../lib/badge-color'

/** The NIP-05 verified tick, in whatever colour the reader chose. */
export function VerifiedBadge({
  size = 15,
  mine = false,
}: {
  size?: number
  /** True only for the reader's own badge. */
  mine?: boolean
}): React.ReactNode {
  // A gradient is referenced by id, and several badges share a page.
  const gradientId = useId()

  return (
    <svg
      width={size}
      // 13:12 in the source artwork.
      height={(size * 12) / 13}
      viewBox="0 0 13 12"
      role="img"
      aria-label="NIP-05 verified"
      className="block shrink-0"
    >
      <defs>
        {/* Both stops read CSS variables, so solid mode is just a gradient whose ends match. */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--badge-a, #1d9bf0)" />
          <stop offset="100%" stopColor="var(--badge-b, #1d9bf0)" />
        </linearGradient>
      </defs>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d={BADGE_PATH}
        fill={mine ? `url(#${gradientId})` : DEFAULT_BADGE}
      />
    </svg>
  )
}
