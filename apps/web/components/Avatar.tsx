'use client'

/* The hook DIRECTLY, not through the package barrel. */
import { useBlossomSrc } from '../lib/blossom-retry'
import type { PfpVariant } from '../lib/pfp-variants'
import { isPrivateUrl, type Hex } from '@nostrich/nostr'

/** Fallback tints, as literal class pairs so Tailwind's scanner can see them. */
const TINTS = [
  'bg-neutral-200 text-neutral-700',
  'bg-neutral-300 text-neutral-800',
  'bg-bg-inset text-text-muted',
  'bg-border text-text-muted',
] as const

const SIZES = {
  /** 28px. For rows of faces beside a line of text, where `sm` would set the line height. */
  xs: 'size-7 text-[11px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  /** 44px, the size a note card's avatar renders. */
  lg: 'size-11 text-base',
  /** 96px, the size a profile header renders. */
  xl: 'size-24 text-3xl',
} as const

export type AvatarSize = keyof typeof SIZES

/** Which rung of the thumbnail ladder each size draws. */
const VARIANTS: Record<AvatarSize, PfpVariant> = {
  xs: 128,
  sm: 128,
  md: 128,
  lg: 128,
  xl: 384,
}

function tintFor(pubkey: Hex): string {
  let hash = 0
  for (let index = 0; index < pubkey.length; index += 1) {
    hash = (hash + pubkey.charCodeAt(index)) % 4096
  }
  return TINTS[hash % TINTS.length] ?? TINTS[0]
}

function initial(name: string): string {
  const first = [...name.trim()][0]
  return first === undefined ? '?' : first.toUpperCase()
}

interface AvatarProps {
  pubkey: Hex
  name: string
  picture?: string | undefined
  size?: AvatarSize
}

/** Imgur's "image removed" graphic, by its exact dimensions. */
const IMGUR_TOMBSTONE = { width: 161, height: 81 }

function isImgurTombstone(image: HTMLImageElement): boolean {
  if (!/(^|\.)imgur\.com$/i.test(new URL(image.currentSrc || image.src, location.href).hostname)) {
    return false
  }
  return image.naturalWidth === IMGUR_TOMBSTONE.width && image.naturalHeight === IMGUR_TOMBSTONE.height
}

export function Avatar({ pubkey, name, picture, size = 'md' }: AvatarProps): React.ReactNode {
  const box = `${SIZES[size]} shrink-0 overflow-hidden rounded-full`
  /* A dead Blossom host is not a dead picture. */
  // An avatar is exactly what the picture cache is for, and at a size we know.
  const { src, fail, onLoad, exhausted } = useBlossomSrc(picture, pubkey, VARIANTS[size])
  /* Loads on approach rather than on mount. */

  /* The private-address check applies to STRANGERS' urls, not to ours. */
  const ourOwn = src !== undefined && src.startsWith('/')
  if (src !== undefined && !exhausted && (ourOwn || !isPrivateUrl(src))) {
    return (
      <img
        src={src}
        alt=""
        width={40}
        height={40}
        decoding="async"
        // Avatars are hosted by strangers.
        referrerPolicy="no-referrer"
        onError={fail}
        // A dead imgur link succeeds and delivers a placeholder.
        onLoad={event => {
          onLoad()
          try {
            if (isImgurTombstone(event.currentTarget)) fail()
          } catch {
            // An unparseable src is not worth a crash in an avatar.
          }
        }}
        className={`${box} bg-bg-inset object-cover`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`${box} ${tintFor(pubkey)} flex items-center justify-center font-semibold`}
    >
      {initial(name)}
    </span>
  )
}
