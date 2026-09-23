import { getTagValues, isReply, parseThread, referencesFromContent, type Hex, type NostrEvent } from '@nostrich/nostr'

/** Whether a kind-1 that p-tags you is actually. */
/** `thread` is its own kind rather than a `mention`, and the distinction is the whole. */
export type NoteNotification = 'reply' | 'quote' | 'mention' | 'thread' | null

export function noteNotificationKind(
  event: NostrEvent,
  viewer: Hex,
  mine: ReadonlySet<string>,
  /** Count a reply that only INHERITED your p-tag as a mention. */
  threadMentions = false,
): NoteNotification {
  // Your own note is never news.
  if (event.pubkey === viewer) return null

  const thread = parseThread(event)
  const answered = isReply(event) ? thread.replyToId : undefined

  /** `replyToId`, not the first e-tag. */
  if (answered !== undefined) {
    if (mine.has(answered)) return 'reply'
    if (namesViewer(event, viewer)) return 'mention'
    // The inherited p-tag, admitted only when the reader has asked.
    return threadMentions && tagsViewer(event, viewer) ? 'thread' : null
  }

  // A quote reaches you the same way and is abusable the same way: quoting a note.
  const quoted = quotedId(event)
  if (quoted !== undefined) {
    if (mine.has(quoted)) return 'quote'
    return namesViewer(event, viewer) ? 'mention' : null
  }

  /** No e-tag and no quote: an ordinary mention, unchanged. */
  return 'mention'
}

/** A `q` tag, or the `mention`-marked e-tag older clients use for the same thing. */
function quotedId(event: NostrEvent): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] === 'q' && tag[1] !== undefined) return tag[1]
    if (tag[0] === 'e' && tag[3] === 'mention' && tag[1] !== undefined) return tag[1]
  }
  return undefined
}

/** Whether the note's TEXT names this reader. */
/** The p-tag, which is the half this file spends its time NOT trusting. */
function tagsViewer(event: NostrEvent, viewer: Hex): boolean {
  return getTagValues(event, 'p').includes(viewer)
}

function namesViewer(event: NostrEvent, viewer: Hex): boolean {
  return referencesFromContent(event.content, event.tags).pubkeys.includes(viewer)
}
