'use client'

import { useEffect, useRef, useState } from 'react'

/** A word that dissolves into dots as you read. */

/** The logo's orange. Same value the word already used as flat text. */
const INK = '#f97315'

/** Grid and gradient constants, as fractions of the glyph box height. */
const SPACING_X = 5.8 / 118
const SPACING_Y = 5.2 / 118
const RADIUS = 1.75 / 118
/** Below this the grid stops reading as dots and starts reading as texture. */
const MIN_RADIUS = 0.85

export function DissolvingWord({ children }: { children: string }): React.ReactNode {
  const holder = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [painted, setPainted] = useState(false)

  useEffect(() => {
    let alive = true

    const paint = (): void => {
      const host = holder.current
      const target = canvas.current
      if (host === null || target === null || !alive) return

      const context = target.getContext('2d')
      if (context === null) return

      const style = window.getComputedStyle(host)
      const size = Number.parseFloat(style.fontSize)
      if (!Number.isFinite(size) || size <= 0) return

      const font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`
      const dpr = Math.max(1, window.devicePixelRatio || 1)

      // Measure first, on the same context, so the box matches what will be drawn.
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.font = font
      // Chrome and Firefox honour.
      if ('letterSpacing' in context) {
        ;(context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
          style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
      }

      const metrics = context.measureText(children)
      const ascent = metrics.actualBoundingBoxAscent
      const descent = metrics.actualBoundingBoxDescent
      const width = metrics.width
      if (!Number.isFinite(ascent) || !Number.isFinite(descent) || width <= 0) return

      // A pixel of margin all round: `actualBoundingBox` is tight to the ink, and a stroke.
      const boxW = Math.ceil(width) + 2
      const boxH = Math.ceil(ascent + descent) + 2
      const baseline = ascent + 1

      target.width = Math.round(boxW * dpr)
      target.height = Math.round(boxH * dpr)
      target.style.width = `${boxW}px`
      target.style.height = `${boxH}px`

      /* Aligned by the BASELINE, not by centring the box. */
      const lineHeight = Number.parseFloat(style.lineHeight)
      const boxLine = Number.isFinite(lineHeight) ? lineHeight : size * 1.2
      // `fontBoundingBox*` is the face's own ascent and descent, the same numbers.
      const faceAscent = Number.isFinite(metrics.fontBoundingBoxAscent)
        ? metrics.fontBoundingBoxAscent
        : size * 0.8
      const faceDescent = Number.isFinite(metrics.fontBoundingBoxDescent)
        ? metrics.fontBoundingBoxDescent
        : size * 0.2
      const halfLeading = (boxLine - (faceAscent + faceDescent)) / 2
      target.style.top = `${halfLeading + faceAscent - baseline}px`

      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, boxW, boxH)
      context.textBaseline = 'alphabetic'
      context.font = font
      if ('letterSpacing' in context) {
        ;(context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
          style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
      }

      // ── Layer 1: the solid word, fading out ─────────────────────────────────────────.
      context.fillStyle = INK
      context.fillText(children, 1, baseline)

      context.globalCompositeOperation = 'destination-in'
      const solidFade = context.createLinearGradient(0, 0, boxW, 0)
      solidFade.addColorStop(0, 'rgba(255,255,255,1)')
      solidFade.addColorStop(0.5, 'rgba(255,255,255,1)')
      solidFade.addColorStop(0.58, 'rgba(255,255,255,0.82)')
      solidFade.addColorStop(0.66, 'rgba(255,255,255,0)')
      solidFade.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = solidFade
      context.fillRect(0, 0, boxW, boxH)
      context.globalCompositeOperation = 'source-over'

      // ── Layer 2: the dots, fading in ────────────────────────────────────────────────.
      const grid = document.createElement('canvas')
      grid.width = target.width
      grid.height = target.height
      const gridContext = grid.getContext('2d')
      if (gridContext === null) return
      gridContext.setTransform(dpr, 0, 0, dpr, 0, 0)

      const stepX = Math.max(2, boxH * SPACING_X)
      const stepY = Math.max(2, boxH * SPACING_Y)
      const radius = Math.max(MIN_RADIUS, boxH * RADIUS)

      gridContext.fillStyle = INK
      let row = 0
      for (let y = -radius; y <= boxH + radius; y += stepY) {
        // Every other row is offset half a step, so the field reads as a scatter of particles.
        const offset = (row % 2) * (stepX / 2)
        for (let x = -radius + offset; x <= boxW + radius; x += stepX) {
          gridContext.beginPath()
          gridContext.arc(x, y, radius, 0, Math.PI * 2)
          gridContext.fill()
        }
        row += 1
      }

      /* Clip the field to the letterforms: the dots ARE the word, not a texture behind. */
      gridContext.globalCompositeOperation = 'destination-in'
      gridContext.font = font
      gridContext.textBaseline = 'alphabetic'
      if ('letterSpacing' in gridContext) {
        ;(gridContext as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
          style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
      }
      gridContext.fillStyle = INK
      gridContext.fillText(children, 1, baseline)

      const dotFade = gridContext.createLinearGradient(0, 0, boxW, 0)
      dotFade.addColorStop(0, 'rgba(255,255,255,0)')
      dotFade.addColorStop(0.45, 'rgba(255,255,255,0)')
      dotFade.addColorStop(0.53, 'rgba(255,255,255,0.3)')
      dotFade.addColorStop(0.61, 'rgba(255,255,255,0.82)')
      dotFade.addColorStop(0.66, 'rgba(255,255,255,1)')
      dotFade.addColorStop(1, 'rgba(255,255,255,1)')
      gridContext.fillStyle = dotFade
      gridContext.fillRect(0, 0, boxW, boxH)
      gridContext.globalCompositeOperation = 'source-over'

      context.drawImage(grid, 0, 0, boxW, boxH)
      setPainted(true)
    }

    // The brand font decides the shape of every glyph here, so painting before it lands.
    const start = (): void => {
      if (typeof document !== 'undefined' && 'fonts' in document) {
        void document.fonts.ready.then(paint)
        return
      }
      paint()
    }
    start()

    // The headline is `clamp(…, 7vw, …)`: its size changes with the window, and so must.
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => paint())
    if (observer !== undefined && holder.current !== null) observer.observe(holder.current)
    window.addEventListener('resize', paint)

    return () => {
      alive = false
      observer?.disconnect()
      window.removeEventListener('resize', paint)
    }
  }, [children])

  return (
    <span ref={holder} className="relative inline-block text-[#f97315]">
      {/* Kept in the flow, so the line breaks and the reading order are the plain text's. */}
      <span className={painted ? 'text-transparent' : undefined}>{children}</span>
      <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute left-0" />
    </span>
  )
}
