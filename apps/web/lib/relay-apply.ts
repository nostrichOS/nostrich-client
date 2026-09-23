'use client'

import { useEffect } from 'react'

import { applyRelaysToPool } from './relay-prefs'
import { parseRelayCookie } from './relay-cookie'

const COOKIE = 'nostrich_relays'

/** Hand the reader's stored relay list to the pool, once, on load. */
export function useStoredRelays(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const match = document.cookie.split('; ').find(row => row.startsWith(`${COOKIE}=`))
    if (match === undefined) return
    const stored = parseRelayCookie(decodeURIComponent(match.slice(COOKIE.length + 1)))
    if (stored === null) return
    applyRelaysToPool(stored.urls, stored.policies ?? {})
  }, [])
}
