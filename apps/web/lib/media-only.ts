'use client'

import { parseContent, type NostrEvent } from '@nostrich/nostr'

import type { QuotedPiece } from './quoted-pieces'

/** What a rail row says about a note that is nothing but a picture. */
export function mediaOnlyLabel(
  event: NostrEvent,
  pieces: readonly QuotedPiece[],
): string | null {
  // Anything to read.
  if (pieces.length > 0) return null

  let images = 0
  let videos = 0
  let audio = 0
  for (const segment of parseContent(event.content, event.tags)) {
    if (segment.type === 'image') images += 1
    else if (segment.type === 'video') videos += 1
    else if (segment.type === 'audio') audio += 1
  }

  /* Singular vs "gallery" is worth the four labels: one photo and eleven photos. */
  if (audio > 0 && images === 0 && videos === 0) return 'Audio'
  if (images > 0 && videos === 0 && audio === 0) return images > 1 ? 'Image gallery' : 'Image note'
  if (videos > 0 && images === 0 && audio === 0) return videos > 1 ? 'Video gallery' : 'Video note'
  // A photo and a clip together.
  if (images + videos + audio > 0) return 'Media gallery'

  /* Empty of words AND of media: a bare quote repost, a note of nothing but custom. */
  return null
}
