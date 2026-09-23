import { parseContent, type NostrEvent } from '@nostrich/nostr'

import { quotePointer } from '../components/QuotedNote'

/** The one link in a note that gets an unfurled preview card, if there is one. */
export function previewableUrl(event: NostrEvent): string | undefined {
  if (quotePointer(event) !== undefined) return undefined
  const segments = parseContent(event.content, event.tags)
  if (segments.some(segment => segment.type === 'image' || segment.type === 'video')) return undefined
  const links = segments.filter(segment => segment.type === 'url')
  return links.length === 1 ? links[0]?.url : undefined
}
