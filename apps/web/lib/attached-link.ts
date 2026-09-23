'use client'

import { useEffect, useState } from 'react'

/** The link a composer has taken out of the text and is showing as a card instead. */

export interface AttachedLink {
  /** The URL being shown as a card, or undefined when there is none. */
  url: string | undefined
  /** Called by the composer once the card is confirmed: strips the URL, remembers. */
  capture: (url: string, text: string, setText: (next: string) => void) => void
  /** Called by the × : takes the link OUT of the draft. */
  discard: (candidate: string, text: string, setText: (next: string) => void) => void
  /** Cleared with the rest of the draft after a successful publish. */
  reset: () => void
}

export function useAttachedLink(): AttachedLink {
  const [url, setUrl] = useState<string | undefined>(undefined)

  return {
    url,
    capture: (next, text, setText) => {
      setUrl(next)
      setText(removeUrl(text, next))
    },
    discard: (candidate, text, setText) => {
      setUrl(undefined)
      // Held means it is already out of the text.
      setText(url === undefined ? removeUrl(text, candidate) : text)
    },
    reset: () => {
      setUrl(undefined)
    },
  }
}

/** Take one URL out of a draft, and the whitespace it was sitting. */
export function removeUrl(text: string, url: string): string {
  const at = text.indexOf(url)
  if (at < 0) return text

  let start = at
  let end = at + url.length
  while (start > 0 && /[^\S\n]/u.test(text[start - 1] ?? '')) start -= 1
  while (end < text.length && /[^\S\n]/u.test(text[end] ?? '')) end += 1
  const hadSpaceBefore = start < at
  const hadSpaceAfter = end > at + url.length

  // A URL alone on its line takes the line.
  const aloneOnLine =
    (start === 0 || text[start - 1] === '\n') && (end === text.length || text[end] === '\n')
  if (aloneOnLine) {
    if (end < text.length) end += 1
    else if (start > 0) start -= 1
  }

  /* A URL mid-sentence leaves ONE space behind, not none. */
  const bridge = !aloneOnLine && hadSpaceBefore && hadSpaceAfter ? ' ' : ''

  return `${text.slice(0, start)}${bridge}${text.slice(end)}`.replace(/\n{3,}/gu, '\n\n')
}

/** Runs the capture once the card is confirmed. */
export function useCaptureWhenReady(
  attached: AttachedLink,
  candidate: string | undefined,
  cardIsReal: boolean,
  text: string,
  setText: (next: string) => void,
): void {
  useEffect(() => {
    if (candidate === undefined || !cardIsReal) return
    if (attached.url !== undefined) return
    if (!text.includes(candidate)) return
    attached.capture(candidate, text, setText)
    // `text` is deliberately not a dependency: this fires on the transition to "card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate, cardIsReal, attached.url])
}
