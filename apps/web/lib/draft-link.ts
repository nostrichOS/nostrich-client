'use client'

import { useEffect, useState } from 'react'
import { parseContent } from '@nostrich/nostr'

/** The link in a draft that gets a preview card, while it is still being written. */

/** Long enough to finish pasting or typing a domain. */
const SETTLE_MS = 600

export function draftLink(text: string, hasMedia: boolean): string | undefined {
  if (hasMedia) return undefined
  const links = parseContent(text, []).filter(segment => segment.type === 'url')
  if (links.length !== 1) return undefined
  const url = links[0]?.url
  // A bare domain the parser linked (`example.com`) is a real link, but not yet a real.
  return url === undefined || !/^https?:\/\//i.test(url) ? undefined : url
}

export function useDraftLink(text: string, hasMedia: boolean): string | undefined {
  const immediate = draftLink(text, hasMedia)
  const [settled, setSettled] = useState(immediate)

  useEffect(() => {
    if (immediate === undefined) {
      // Clearing is instant.
      setSettled(undefined)
      return
    }
    const timer = setTimeout(() => setSettled(immediate), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [immediate])

  return settled
}
