'use client'

import { useLayoutEffect, useState } from 'react'

/** WHERE THE `@` IS ON SCREEN, so the picker can open under it rather. */

export interface CaretAnchor {
  /** Offsets from the anchor element's own box, ready for `style`. */
  top: number
  left: number
}

/** The rectangle of one character inside an element, by its index in that element's. */
export function caretRectIn(mirror: HTMLElement, index: number): DOMRect | null {
  const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT)
  let seen = 0
  let node = walker.nextNode()
  while (node !== null) {
    const length = node.textContent?.length ?? 0
    if (seen + length >= index) {
      const range = document.createRange()
      const offset = Math.max(0, Math.min(index - seen, length))
      try {
        range.setStart(node, offset)
        range.setEnd(node, Math.min(offset + 1, length))
      } catch {
        return null
      }
      const rect = range.getBoundingClientRect()
      // A collapsed range on an empty line has no width.
      return rect.width === 0 && rect.height === 0 ? null : rect
    }
    seen += length
    node = walker.nextNode()
  }
  return null
}

/** Where to put a panel so it hangs under the character at `index`. */
export function useCaretAnchor(
  mirror: HTMLElement | null,
  anchor: HTMLElement | null,
  index: number | undefined,
  width: number,
  /** The field's text, as a dependency only. */
  text: string,
): CaretAnchor | undefined {
  const [at, setAt] = useState<CaretAnchor | undefined>(undefined)

  useLayoutEffect(() => {
    if (mirror === null || anchor === null || index === undefined) {
      setAt(undefined)
      return
    }
    const caret = caretRectIn(mirror, index)
    if (caret === null) return
    const box = anchor.getBoundingClientRect()
    /* Clamped to the anchor's width so a mention typed at the end of a long line does. */
    const left = Math.max(0, Math.min(caret.left - box.left, Math.max(0, box.width - width)))
    setAt({ top: caret.bottom - box.top, left })
    // `index` and the text both move the caret.
  }, [mirror, anchor, index, width, text])

  return at
}
