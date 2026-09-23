import { SvgImage } from './svg-image'

import { FILLABLE, PATHS, STROKE, type IconName } from './icon-paths'

/** The note action icons. */

export type { IconName }

function uri(name: IconName, color: string, filled: boolean, size: number): string {
  const path = PATHS[name]
  // width/height are NOT optional here.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="${filled && FILLABLE[name] ? color : 'none'}" ` +
    `stroke="${color}" stroke-width="${filled && !FILLABLE[name] ? STROKE * 1.2 : STROKE}" ` +
    `stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${path}"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

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
    <SvgImage
      uri={uri(name, color, filled, size)}
      style={{ width: size, height: size }}
    />
  )
}
