import { FILLABLE, PATHS, type IconName } from './icon-paths'

export type { IconName }

/** Web implementation of the action icons. */
export function ActionIcon({
  name,
  color,
  filled = false,
  size = 18,
}: {
  name: IconName
  color: string
  /** Set once the reader has performed the action. */
  filled?: boolean
  size?: number
}): React.ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled && FILLABLE[name] ? color : 'none'}
      stroke={color}
      // 2.4, not 2. Enough to read as heavier at 18px without the silhouette changing.
      strokeWidth={filled && !FILLABLE[name] ? 2.4 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
