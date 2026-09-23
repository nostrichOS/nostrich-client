'use client'

import { useEffect, useMemo, useState } from 'react'
import { parseContent, splitMedia, type ContentSegment } from '@nostrich/nostr'

import { removeFromDraft } from './draft-quote'

/** MEDIA SOMEBODY PASTED AS A URL, so the composer can show it the way the note will. */

export interface DraftMediaItem {
  type: 'image' | 'video' | 'audio'
  url: string
}

/** How many pasted media URLs the composer will draw. */
const MAX_ITEMS = 4

export function draftMedia(text: string): DraftMediaItem[] {
  if (!text.includes('http')) return []
  const { media } = splitMedia(parseContent(text, []))
  const out: DraftMediaItem[] = []
  const seen = new Set<string>()
  for (const segment of media as ContentSegment[]) {
    if (segment.type !== 'image' && segment.type !== 'video' && segment.type !== 'audio') continue
    // The same URL twice in a draft is one thing to preview, not two.
    if (seen.has(segment.url)) continue
    seen.add(segment.url)
    out.push({ type: segment.type, url: segment.url })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

/** Media URLs held out of the draft, appended again at publish. */
export function useAttachedMedia(
  text: string,
  setText: (next: string) => void,
): { items: DraftMediaItem[]; attached: string[]; dismiss: (url: string) => void; reset: () => void } {
  const [held, setHeld] = useState<DraftMediaItem[]>([])

  /* No "waved away" list, unlike the earlier drafts of the quote and link hooks. */
  const found = useMemo(() => draftMedia(text), [text])

  useEffect(() => {
    if (found.length === 0) return
    const next = found.reduce((acc, item) => removeFromDraft(acc, item.url), text)
    if (next === text) return
    setHeld(current => {
      const seen = new Set(current.map(item => item.url))
      return [...current, ...found.filter(item => !seen.has(item.url))].slice(0, MAX_ITEMS)
    })
    setText(next)
    // Fires on the transition, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found.map(item => item.url).join(',')])

  return {
    items: held,
    attached: held.map(item => item.url),
    dismiss: url => {
      // Gone from the note, not merely from the preview: the note RENDERS media.
      setHeld(current => current.filter(item => item.url !== url))
    },
    reset: () => {
      setHeld([])
    },
  }
}
