'use client'

import type { Hex } from '@nostrich/nostr'

import { activeScope } from './scope'
import { isMuted } from './user-lists'

/** Which replies in a thread are shown outright, and which are folded behind. */

/** Anything with a `children` array of the same shape. */
export interface ReplyNode {
  event: { id: string; pubkey: Hex; created_at: number }
  children: ReplyNode[]
}

/** Below this, the disclosure row costs more attention than the replies it hides. */
export const MIN_TO_FOLD = 3

export interface RankedReplies<T> {
  /** Rendered normally, in this order. */
  shown: T[]
  /** Folded behind one row. */
  folded: T[]
}

/** @param isLowSignal Whether this author's reply belongs behind the disclosure. */
export function rankReplies<T extends ReplyNode>(
  replies: readonly T[],
  options: {
    /** The author of the note being replied. */
    threadAuthor?: Hex
    /** The reader. Their own replies are never folded, whatever else is true of them. */
    viewer?: Hex
    /** A GUESS about the account. */
    isLowSignal?: (pubkey: Hex) => boolean
    /** A DECISION about this note. */
    isHidden?: (node: T) => boolean
  } = {},
): RankedReplies<T> {
  const { threadAuthor, viewer, isLowSignal, isHidden } = options

  const shown: T[] = []
  const folded: T[] = []
  /** Folded for a reason that stands on its own. */
  let definite = 0

  for (const node of replies) {
    const author = node.event.pubkey
    // Two exemptions, both about authorship rather than trust: the person being replied.
    if (author === threadAuthor || author === viewer) {
      shown.push(node)
      continue
    }
    // `author === activeScope()` for the same reason as `mutedFor`: a mute list scoped.
    if ((author !== activeScope() && isMuted(author)) || isHidden?.(node) === true) {
      folded.push(node)
      definite += 1
      continue
    }
    if (isLowSignal?.(author) === true) {
      folded.push(node)
      continue
    }
    shown.push(node)
  }

  /* The threshold only ever governed the guesses, and applying it to everything. */
  if (definite === 0 && folded.length < MIN_TO_FOLD) {
    return { shown: replies.slice(), folded: [] }
  }

  return { shown, folded }
}
