'use client'

import { useEffect, useRef } from 'react'

import { attach, confetti, fire, particleCount, resize, tierFor } from '../lib/fx/engine'

/** The one canvas the zap and the like draw on, mounted once for the whole app. */
export function FxCanvas(): React.ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return
    attach(canvas)
    const onResize = (): void => resize(canvas)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      attach(undefined)
    }
  }, [])

  /** A way to fire the effects without spending sats, behind `?fx=1`. */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!new URLSearchParams(window.location.search).has('fx')) return
    const w = window as unknown as { __fx?: unknown }
    w.__fx = { fire, confetti, tierFor, particleCount }
    return () => {
      delete w.__fx
    }
  }, [])

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-50" />
}
