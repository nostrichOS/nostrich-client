'use client'

import { useEffect, type RefObject } from 'react'

/** Close a popover when the reader clicks away from it or presses Escape. */
export function useDismiss(
  /** Whether the popover is open. Nothing is listened. */
  open: boolean,
  /** The popover's outer element, including whatever button toggles. */
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent): void => {
      // A press inside is the reader using the thing, not leaving.
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open, ref, onClose])
}
