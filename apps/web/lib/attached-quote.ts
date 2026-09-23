'use client'

import { useEffect, useMemo, useState } from 'react'

import { useAddressEvent } from './addresses'
import { draftQuote, draftQuoteKey, publishedForm, removeFromDraft, type DraftQuote } from './draft-quote'

/** THE POINTER A COMPOSER HAS TAKEN OUT OF THE TEXT AND IS SHOWING AS A CARD INSTEAD. */

export interface AttachedQuote {
  /** What to draw, whether or not it has been lifted out of the text yet. */
  quote: DraftQuote | undefined
  /** Appended to the body at publish, ready to use. */
  attached: string | undefined
  /** Removes the quote from the draft entirely. */
  dismiss: (text: string, setText: (next: string) => void) => void
  /** Cleared with the rest of the draft after a successful publish. */
  reset: () => void
}

export function useAttachedQuote(
  text: string,
  setText: (next: string) => void,
  /** False when the composer already has an explicit quote. */
  enabled = true,
): AttachedQuote {
  /** The pointer lifted out of the text, held while the note is written. */
  const [held, setHeld] = useState<DraftQuote | undefined>(undefined)

  /* Read from the draft only while nothing is held. */
  const found = useMemo(
    () => (enabled && held === undefined ? draftQuote(text) : undefined),
    [enabled, held, text],
  )
  const candidate = held ?? found
  const key = draftQuoteKey(candidate)

  /* BOTH resolvers run every render, with `undefined` for the inactive one. */
  const address = useAddressEvent(candidate?.type === 'address' ? candidate : undefined)

  /* An event pointer is confirmed by the CARD, not here. */
  const confirmed =
    candidate !== undefined &&
    (candidate.type === 'event' || address.event !== undefined)

  useEffect(() => {
    if (held !== undefined || found === undefined || !confirmed) return
    // `raw`, not `bech32`: what leaves the draft is what the author actually typed.
    const next = removeFromDraft(text, found.raw)
    // Nothing to lift if the pointer is not actually in the text.
    if (next === text) return
    setHeld(found)
    setText(next)
  }, [held, found, confirmed, key, text, setText])

  return {
    quote: candidate,
    attached: held === undefined ? undefined : publishedForm(held),
    dismiss: (current, write) => {
      if (candidate === undefined) return
      setHeld(undefined)
      /* Held means it is already out of the text and dropping the state is the whole job. */
      if (held === undefined) write(removeFromDraft(current, candidate.raw))
    },
    reset: () => {
      setHeld(undefined)
    },
  }
}
