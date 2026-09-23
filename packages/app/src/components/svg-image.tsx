import { Image, type ImageStyle } from 'react-native'

/** An inline SVG, drawn as an image. */
export function SvgImage({
  uri,
  style,
  accessibilityLabel,
}: {
  uri: string
  style: ImageStyle
  accessibilityLabel?: string
}): React.ReactNode {
  return (
    <Image
      source={{ uri }}
      style={style}
      accessibilityLabel={accessibilityLabel}
      // These are flat glyphs, not photographs.
      accessibilityIgnoresInvertColors
    />
  )
}
