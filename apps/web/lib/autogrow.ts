'use client'

import { useEffect, useLayoutEffect, type RefObject } from 'react'

/** BEFORE PAINT. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** A textarea that grows with what is typed. */
/** Within a pixel of the bottom. */
export function atBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= 1
}

/** The thing that will actually move when this field changes height. */
function scrollHost(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el !== null; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY
    if (/(auto|scroll|overlay)/.test(overflow) && el.scrollHeight > el.clientHeight) return el
  }
  // The page itself, for the inline composer on a normally scrolling feed.
  const root = document.scrollingElement
  return root instanceof HTMLElement ? root : null
}

export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  /** Where growing stops and scrolling resumes. */
  maxFraction = 0.6,
  minMax = 320,
): void {
  useIsomorphicLayoutEffect(() => {
    const node = ref.current
    if (node === null) return

    const measure = (): void => {
      // Measured per run, not captured once: a value read at import is wrong for the rest.
      const ceiling =
        typeof window === 'undefined'
          ? minMax
          : Math.max(minMax, Math.round(window.innerHeight * maxFraction))

      /** THE FIELD'S SCROLL POSITION IS PUT BACK, and leaving it out was a real bug. */
      /** THE BOX THAT SCROLLS IS OFTEN NOT THIS ONE. */
      const host = scrollHost(node)
      const hostHeld = host === null ? 0 : host.scrollTop
      const hostAtBottom =
        host !== null && atBottom(host.scrollTop, host.scrollHeight, host.clientHeight)

      const held = node.scrollTop
      // Typing at the END is the ordinary case, and there "put it back" means the bottom.
      const wasAtBottom = atBottom(held, node.scrollHeight, node.clientHeight)
      node.style.height = 'auto'
      const natural = node.scrollHeight

      /** A zero measurement means the field is not laid out yet. */
      if (natural <= 0) return
      node.style.height = `${Math.min(natural, ceiling)}px`
      // A box that no longer scrolls ignores this, which is the correct no-op.
      node.scrollTop = wasAtBottom ? node.scrollHeight : held
      /* Restored AFTER the final height, so the maximum it is being clamped. */
      if (host !== null) host.scrollTop = hostAtBottom ? host.scrollHeight : hostHeld
    }

    measure()

    /** Then again after layout, and again after the webfont lands. */
    const frame = requestAnimationFrame(measure)
    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [ref, value, maxFraction, minMax])
}
