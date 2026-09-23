'use client'

import { useCallback, useRef, useState } from 'react'

/** Whether a node has been scrolled near enough to be worth paying. */
const ROOT_MARGIN = '200px'

export function useInView(): [(node: Element | null) => void, boolean] {
  const [seen, setSeen] = useState(false)
  const observer = useRef<IntersectionObserver | undefined>(undefined)

  const ref = useCallback((node: Element | null): void => {
    observer.current?.disconnect()
    observer.current = undefined
    if (node === null) return

    // No IntersectionObserver means the server, or a browser old enough that the honest.
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }

    const instance = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        setSeen(true)
        instance.disconnect()
      },
      { rootMargin: ROOT_MARGIN },
    )
    instance.observe(node)
    observer.current = instance
  }, [])

  return [ref, seen]
}
