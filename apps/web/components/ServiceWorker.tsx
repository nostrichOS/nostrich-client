'use client'

import { useEffect } from 'react'

/** Registers the service worker, which is what makes the app installable in Chromium. */
export function ServiceWorker(): null {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    const register = (): void => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* No install prompt. */
      })
    }

    if (document.readyState === 'complete') {
      register()
      return
    }
    window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
