'use client'

import { useMemo } from 'react'
import { qrPath } from '@nostrich/app'

/** A QR code as inline SVG. */
export function QrCode({
  value,
  size = 232,
  label,
}: {
  value: string
  size?: number
  label: string
}): React.ReactNode {
  /* Encoded by `@nostrich/app`, so the phone and this browser cannot produce different. */
  const path = useMemo(() => qrPath(value), [value])

  return (
    <svg
      viewBox={`0 0 ${path.count} ${path.count}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="rounded-lg bg-white p-2"
    >
      {/* Always a white ground with black modules, in both themes. */}
      <rect width={path.count} height={path.count} fill="#ffffff" />
      <path d={path.d} fill="#000000" />
    </svg>
  )
}
