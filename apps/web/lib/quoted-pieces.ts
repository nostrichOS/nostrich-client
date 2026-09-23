'use client'

import { parseContent, type Hex, type NostrEvent } from '@nostrich/nostr'

import { rememberProfileHints } from './profile-hints'

/** A quoted note's words, flattened to what a compact card can render. */

export type QuotedPiece = string | { pubkey: Hex } | { url: string }

export function quotedPieces(event: NostrEvent, hideUrl?: string): QuotedPiece[] {
  const out: QuotedPiece[] = []
  for (const segment of parseContent(event.content, event.tags)) {
    switch (segment.type) {
      case 'text':
        out.push(segment.value)
        break
      case 'hashtag':
        out.push(`#${segment.tag}`)
        break
      case 'url':
        /* The one URL the card below is already showing is dropped rather than printed twice. */
        out.push(segment.url === hideUrl ? '' : { url: segment.url })
        break
      case 'image':
      case 'video':
        out.push('')
        break
      case 'mention':
        // Same hint, same reason as the timeline card.
        rememberProfileHints(segment.pubkey, segment.relays)
        out.push({ pubkey: segment.pubkey })
        break
      default:
        break
    }
  }

  /** The blank line a removed quote leaves behind. */
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop()
  while (out.length > 0 && isBlank(out[0])) out.shift()
  const last = out[out.length - 1]
  if (typeof last === 'string') out[out.length - 1] = last.replace(/\s+$/, '')
  const first = out[0]
  if (typeof first === 'string') out[0] = first.replace(/^\s+/, '')

  return out
}

/** A piece with nothing in it but whitespace. */
function isBlank(piece: QuotedPiece | undefined): boolean {
  return typeof piece === 'string' && piece.trim() === ''
}

/** The note's words as a bare string, mentions included only as a placeholder. */
export function plainText(event: NostrEvent): string {
  return quotedPieces(event)
    .map(piece => {
      if (typeof piece === 'string') return piece
      // A URL still reads as itself in a plain string.
      return 'url' in piece ? piece.url : '@…'
    })
    .join('')
    .trim()
}