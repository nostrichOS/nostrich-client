import { useId } from 'react'
import { useTheme } from '../theme'
import { BADGE_PATH } from './icon-paths'

/** Web implementation of the NIP-05 verified badge. */
export function VerifiedBadge({ size = 15, mine = false }: { size?: number; mine?: boolean }): React.ReactNode {
  const theme = useTheme()
  // A gradient is referenced by id and several badges share a page, so the id must.
  const gradientId = useId()
  /** The custom colour is the READER's, and it paints the READER's badge only. */
  const paint = mine ? `url(#${gradientId})` : theme.verified

  return (
    <svg
      width={size}
      // 13:12 in the source artwork.
      height={(size * 12) / 13}
      viewBox="0 0 13 12"
      role="img"
      aria-label="NIP-05 verified"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {mine ? (
        <defs>
          {/* Solid mode sets both stops to the same colour upstream, so one path draws. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`var(--badge-a, ${theme.verified})`} />
            <stop offset="100%" stopColor={`var(--badge-b, ${theme.verified})`} />
          </linearGradient>
        </defs>
      ) : null}
      <path fillRule="evenodd" clipRule="evenodd" d={BADGE_PATH} fill={paint} />
    </svg>
  )
}
