'use client'

import type { FeedSource } from './feed'

/** A stable identity for a source. */
export function sourceKey(source: FeedSource): string {
  switch (source.kind) {
    case 'verified':
      return 'verified'
    case 'trending':
      return `trending:${[...source.ids].sort().join(',')}`
    case 'hashtag':
      return `hashtag:${source.tag}`
    case 'authors':
      return `authors:${[...source.authors].sort().join(',')}`
    case 'custom':
      return `custom:${[...source.hashtags].sort().join(',')}|${[...source.authors].sort().join(',')}`
  }
}

/** The key a feed is filed. */
export function snapshotKey(source: FeedSource): string {
  return source.kind === 'trending' ? `trending:w${source.hours}` : sourceKey(source)
}
