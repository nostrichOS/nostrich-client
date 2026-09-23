import { graphemes } from '@nostrich/nostr'

/** What a kind-7 actually says. */

export type ReactionFlavour = 'like' | 'dislike' | 'emoji'

/** One reaction, ready to draw. */
export interface ReactionMark {
  /** What to print when there is no image: the emoji, or the literal `:shortcode:`. */
  display: string
  /** A NIP-30 custom emoji's image, when the event carried a tag naming one. */
  url?: string
}

export function reactionFlavour(content: string | undefined): ReactionFlavour {
  const value = (content ?? '').trim()
  // Empty counts as a like because NIP-25 says an empty content SHOULD be treated.
  if (value === '' || value === '+') return 'like'
  if (value === '-') return 'dislike'
  return 'emoji'
}

/** Two, because a reaction is one emoji in practice and anything longer is someone. */
const MARK_GRAPHEMES = 2

/** The mark to draw for a reaction, or nothing for a plain like or dislike. */
export function reactionMarkOf(
  content: string | undefined,
  tags: readonly (readonly string[])[],
): ReactionMark | undefined {
  if (reactionFlavour(content) !== 'emoji') return undefined
  const raw = (content ?? '').trim()

  const shortcode = /^:([\w-]+):$/.exec(raw)?.[1]
  if (shortcode !== undefined) {
    const url = tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode)?.[2]
    // The scheme is checked HERE rather than in the component so a test can hold.
    return url !== undefined && /^https?:\/\//i.test(url) ? { display: raw, url } : { display: raw }
  }

  return { display: graphemes(raw).slice(0, MARK_GRAPHEMES).join('') }
}

/** Distinct marks shown on a grouped row before the rest become a number. */
export const MAX_GROUP_MARKS = 3

/** The distinct reactions in a group, most-sent first. */
export function summariseMarks(
  reactions: readonly { content?: string; tags: readonly (readonly string[])[] }[],
): { marks: ReactionMark[]; more: number } {
  const held = new Map<string, { mark: ReactionMark; count: number; at: number }>()
  for (const [at, reaction] of reactions.entries()) {
    const mark = reactionMarkOf(reaction.content, reaction.tags)
    if (mark === undefined) continue
    const seen = held.get(mark.display)
    if (seen === undefined) held.set(mark.display, { mark, count: 1, at })
    else seen.count += 1
  }

  const ordered = [...held.values()].sort((a, b) => b.count - a.count || a.at - b.at)
  return {
    marks: ordered.slice(0, MAX_GROUP_MARKS).map(entry => entry.mark),
    more: Math.max(0, ordered.length - MAX_GROUP_MARKS),
  }
}

/** The sentence around the marks: `{before} {marks} {after}`. */
export function reactionVerb(flavour: ReactionFlavour): { before: string; after: string } {
  if (flavour === 'like') return { before: 'liked your note', after: '' }
  if (flavour === 'dislike') return { before: 'disliked your note', after: '' }
  return { before: 'reacted', after: 'to your note' }
}
