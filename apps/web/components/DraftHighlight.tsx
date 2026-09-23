'use client'

import { useMemo } from 'react'
import { linkRanges } from '@nostrich/nostr'

import { mentionRanges } from '../lib/mentions'

/** The coloured text sitting exactly behind the composer's textarea. */

/** Every metric that affects where a glyph lands. */
export const DRAFT_TYPOGRAPHY =
  'w-full whitespace-pre-wrap break-words pb-0 pt-2 text-xl leading-snug tracking-normal'

/** The weight of a highlighted link. */
const LINK_WEIGHT = '[-webkit-text-stroke:0.4px_currentColor]'

export function DraftHighlight({
  value,
  mentions,
  trackRef,
}: {
  value: string
  /** `@Name` tokens the picker has resolved. */
  mentions?: readonly string[]
  /** A handle on the layer that MOVES, so the field can drive it directly. */
  trackRef?: React.RefObject<HTMLDivElement | null>
}): React.ReactNode {
  const parts = useMemo(() => {
    // Links and mentions in one ordered pass.
    const ranges = [
      ...linkRanges(value).map(range => ({ ...range })),
      ...mentionRanges(value, mentions ?? []),
    ].sort((a, b) => a.start - b.start)

    const out: { text: string; link: boolean }[] = []
    let cursor = 0
    for (const range of ranges) {
      if (range.start < cursor) continue
      if (range.start > cursor) out.push({ text: value.slice(cursor, range.start), link: false })
      out.push({ text: value.slice(range.start, range.end), link: true })
      cursor = range.end
    }
    out.push({ text: value.slice(cursor), link: false })
    return out
  }, [value, mentions])

  return (
    /** TWO elements, and the split is the whole point. */
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
    <div
      /** This layer carries ALL the visible text, not just the coloured parts. */
      ref={trackRef}
      className={`text-text ${DRAFT_TYPOGRAPHY}`}
    >
      {parts.map((part, index) =>
        part.link ? (
          <span key={index} className={`text-link ${LINK_WEIGHT}`}>
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
      {/* A trailing newline is collapsed by the layout engine but not by the textarea. */}
      {'​'}
    </div>
    </div>
  )
}
