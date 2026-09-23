'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_BLOSSOM_SERVERS,
  blossomAlternatives,
  noteHostFailure,
  noteHostSuccess,
  reorderByHealth,
  type Hex,
} from '@nostrich/nostr'

import { useBlossomServerList } from './blossom-servers'
import { pfpVariantPath, type PfpVariant } from './pfp-variants'

/** An image source that survives one Blossom host going down. */
/** Our own copy of a picture. */
export function cachedPfp(url: string, variant?: PfpVariant): string {
  const path = variant === undefined ? '/api/pfp' : pfpVariantPath(variant)
  return `${path}?u=${encodeURIComponent(url)}`
}

/** Source urls our cache has already said. */
const missing = new Set<string>()

/** The next copy to try: the first candidate nothing has reported a failure. */
export function nextCandidate(
  chain: readonly string[],
  tried: readonly string[],
): string | undefined {
  return chain.find(candidate => !tried.includes(candidate))
}

export function useBlossomSrc(
  url: string | undefined,
  /** The author, so their own kind-10063 servers are tried before ours. */
  author?: Hex,
  /** Serve this picture from our own copy, falling through to the origin when we lack one. */
  viaCache: boolean | PfpVariant = false,
): {
  /** What to put in `src`. Undefined once everything has been tried. */
  src: string | undefined
  /** Call from `onError`. */
  fail: () => void
  /** Call from `onLoad`, so the stall timer stops. */
  onLoad: () => void
  /** True when every known copy failed. */
  exhausted: boolean
} {
  /** Copies that have already reported a failure. */
  const [tried, setTried] = useState<readonly string[]>([])
  /** The copy that actually loaded, once one. */
  const [shown, setShown] = useState<string | undefined>(undefined)
  /* The author's server list is only fetched once something has ALREADY failed. */
  const { servers: authorServers, settled: serversSettled } = useBlossomServerList(
    author,
    tried.length > 0,
  )
  const chain = useMemo(() => {
    if (url === undefined || url === '') return []
    // The author's own servers first: they published them.
    const servers = [...authorServers, ...DEFAULT_BLOSSOM_SERVERS]
    // Our own copy goes FIRST.
    const ours =
      viaCache !== false && !missing.has(url)
        ? [cachedPfp(url, viaCache === true ? undefined : viaCache)]
        : []
    /* Hosts already known to be failing go to the BACK. */
    // Our copy is exempt from reordering: it is on our own origin, and a demotion earned.
    return [...ours, ...reorderByHealth([url, ...blossomAlternatives(url, servers)])]
  }, [url, authorServers, viaCache])
  const src = shown ?? nextCandidate(chain, tried)

  /* Restart the walk when the PICTURE changes. */
  useEffect(() => {
    setTried([])
    setShown(undefined)
  }, [url])

  /* A HANG IS A FAILURE, and the browser will not say so for thirty seconds. */
  /* NO STALL TIMER. */

  return {
    src,
    fail: () => {
      if (src === undefined) return
      noteHostFailure(src)
      // Our own cache answering 404 is a fact about this url, not about a host being down.
      if (url !== undefined && src.startsWith('/api/pfp')) missing.add(url)
      setTried(current => (current.includes(src) ? current : [...current, src]))
    },
    onLoad: () => {
      if (src !== undefined) noteHostSuccess(src)
      setShown(src)
      /* Take a copy, now that the reader already has their picture. */
      if (viaCache !== false && url !== undefined && src === url) {
        void fetch(cachedPfp(url, viaCache === true ? undefined : viaCache), {
          method: 'GET',
          keepalive: true,
          cache: 'no-store',
        }).catch(() => undefined)
      }
    },
    /* EVERY copy tried, and no more are coming. */
    exhausted: src === undefined && serversSettled,
  }
}
