'use client'

import { PATHS, STROKE, type ActionIconName } from '@nostrich/app'

/** A reply / repost / zap / like / bookmark glyph, anywhere outside a note card. */
export function InteractionIcon({
  name,
  size = 20,
  filled = false,
}: {
  name: ActionIconName
  size?: number
  /** Active state swaps stroke for fill rather than swapping in a different shape. */
  filled?: boolean
}): React.ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      width={size}
      height={size}
      className="shrink-0"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      // From `icon-paths`, so this glyph and the note row's can never drift apart.
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
