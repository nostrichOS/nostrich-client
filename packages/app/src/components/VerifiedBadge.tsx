import { SvgImage } from './svg-image'

import { useTheme } from '../theme'
import { BADGE_PATH } from './icon-paths'

/** The NIP-05 verified badge. */

function badgeUri(fill: string, size: number): string {
  // Explicit pixel width/height, not just the viewBox: react-native-web paints.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${(size * 12) / 13}" viewBox="0 0 13 12">` +
    `<path fill-rule="evenodd" clip-rule="evenodd" d="${BADGE_PATH}" fill="${fill}"/>` +
    `</svg>`
  // `charset=utf-8`, not the common `.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function VerifiedBadge({
  size = 15,
}: {
  size?: number
  /** Web-only: the reader's own tick takes their chosen colour. */
  mine?: boolean
}): React.ReactNode {
  const theme = useTheme()
  return (
    <SvgImage
      uri={badgeUri(theme.verified, size)}
      // 13:12 in the source artwork.
      style={{ width: size, height: (size * 12) / 13 }}
      accessibilityLabel="NIP-05 verified"
    />
  )
}
