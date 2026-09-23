import { parseContent, type ContentSegment } from '@nostrich/nostr'

export interface MessageParts {
  /** The words, with the media URLs taken out. */
  text: string
  /** Every picture or clip the body pointed at, in the order it named them. */
  media: (ContentSegment & { type: 'image' | 'video'; url: string })[]
}

/** A message body split into the words and the pictures. */
export function splitMessage(content: string): MessageParts {
  const segments = parseContent(content, [])
  const media = segments.filter(
    (segment): segment is ContentSegment & { type: 'image' | 'video'; url: string } =>
      segment.type === 'image' || segment.type === 'video',
  )

  let text = content
  for (const segment of media) {
    // `split`/`join` rather than `replace`, which takes the first match only.
    text = text.split(segment.url).join('')
  }

  return { text: text.trim(), media }
}
