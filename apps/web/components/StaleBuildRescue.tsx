'use client'

import { useEffect } from 'react'

/** A page from a build that no longer exists reloads itself, once, instead of dying. */
const STAMP = 'nostrich:rescue-at'
const MIN_INTERVAL_MS = 60_000

function rescue(): void {
  try {
    const last = Number(sessionStorage.getItem(STAMP) ?? '0')
    if (Date.now() - last < MIN_INTERVAL_MS) return
    sessionStorage.setItem(STAMP, String(Date.now()))
  } catch {
    // Storage unavailable: reload anyway.
  }
  window.location.reload()
}

function isChunkFailure(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false
  if (reason.name === 'ChunkLoadError') return true
  // Webpack, Chrome dynamic import, and Safari dynamic import respectively.
  return /Loading chunk .+ failed|Failed to fetch dynamically imported module|Importing a module script failed/.test(
    reason.message,
  )
}

export function StaleBuildRescue(): null {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent): void => {
      if (isChunkFailure(event.reason)) rescue()
    }
    /* Resource load errors do not bubble, but they ARE observable on window. */
    const onError = (event: Event): void => {
      const target = event.target
      if (
        target instanceof HTMLScriptElement &&
        target.src.includes('/_next/static/') &&
        !target.dataset['rescued']
      ) {
        target.dataset['rescued'] = '1'
        rescue()
      }
    }
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError, true)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError, true)
    }
  }, [])
  return null
}
