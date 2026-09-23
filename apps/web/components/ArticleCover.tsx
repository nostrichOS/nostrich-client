'use client'

import type { Hex } from '@nostrich/nostr'

import { useBlossomSrc } from '../lib/blossom-retry'

/** AN ARTICLE'S COVER ART, AND WHAT STANDS IN FOR IT WHEN NOBODY WILL SERVE. */
export function ArticleCover({
  url,
  author,
  className,
  alt = '',
  icon = 24,
  eager = false,
}: {
  /** The URL the article's `image` tag names. */
  url: string
  /** Whose article it is, so their own Blossom servers are walked before ours. */
  author: Hex
  /** The frame. */
  className: string
  alt?: string
  /** Glyph size in px, matched to the frame: a 48px thumbnail cannot hold a 24px icon. */
  icon?: number
  /** True only for the article page's own cover, which is above the fold by definition. */
  eager?: boolean
}): React.ReactNode {
  const { src, fail, onLoad, exhausted } = useBlossomSrc(url, author)

  if (src === undefined || exhausted) {
    return (
      <span className={`relative ${className}`} aria-hidden="true">
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className="material-symbols-outlined text-text-faint"
            style={{ fontSize: `${icon}px` }}
          >
            image
          </span>
        </span>
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      // Article art is hosted by strangers.
      referrerPolicy="no-referrer"
      onError={fail}
      onLoad={onLoad}
      className={className}
    />
  )
}
