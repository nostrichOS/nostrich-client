'use client'

import { useState, type CSSProperties } from 'react'

import { mediaPreset } from '@nostrich/nostr'

/** A media box shaped like the picture inside it, instead of a picture floating. */

/** The tallest a preview may be, in pixels. */
export const PREVIEW_MAX_HEIGHT = 512
/** The reply composer's, which sits inside a thread and gets less room. */
export const REPLY_PREVIEW_MAX_HEIGHT = 384

/** The box for one picture, or `undefined` while its shape is unknown. */
export function fitBox(
  ratio: number | undefined,
  cap: number = PREVIEW_MAX_HEIGHT,
): CSSProperties | undefined {
  if (ratio === undefined || !Number.isFinite(ratio) || ratio <= 0) return undefined
  return {
    aspectRatio: String(ratio),
    maxWidth: `${Math.round(cap * ratio)}px`,
  }
}

/** The box for a lone picture in a preview: its style, and whether it has a shape yet. */
export interface PreviewBox {
  style: CSSProperties
  /** The box knows the picture's shape, so the element takes the full column width. */
  sized: boolean
}

/** How ONE picture is sized inside a preview. */
export function previewBox(ratio: number | undefined, cap: number): PreviewBox {
  if (ratio === undefined || !Number.isFinite(ratio) || ratio <= 0) {
    return { style: { maxHeight: `${cap}px` }, sized: false }
  }
  if (mediaPreset(ratio) !== 'vertical') return { style: { aspectRatio: String(ratio) }, sized: true }
  return { style: { maxHeight: `${cap}px`, ...fitBox(ratio, cap) }, sized: true }
}

export interface NaturalRatio {
  ratio: number | undefined
  /** Called from `onLoad` / `onLoadedMetadata` with the media's intrinsic size. */
  learn: (width: number, height: number) => void
}

/** The intrinsic shape of a picture or a clip, learned when it loads. */
export function useNaturalRatio(): NaturalRatio {
  const [ratio, setRatio] = useState<number | undefined>(undefined)
  return {
    ratio,
    learn: (width, height) => {
      if (width > 0 && height > 0) setRatio(width / height)
    },
  }
}
