'use client'

/** Making the counts sit the same distance from their icons. */

/** Pixels from the hover circle's edge to where the count's ink begins. */
const GAP = 5
/** Supersample factor, and the left padding inside the probe canvas. */
const SS = 4
const PAD = 20

let probe: CanvasRenderingContext2D | null | undefined

function context(): CanvasRenderingContext2D | null {
  if (probe !== undefined) return probe
  if (typeof document === 'undefined') {
    probe = null
    return probe
  }
  /* `willReadFrequently`, because this canvas exists ONLY to be read back. */
  probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  return probe
}

function bearingOf(el: HTMLElement): number {
  const ctx = context()
  if (ctx === null) return 0
  const cs = getComputedStyle(el)
  const size = Number.parseFloat(cs.fontSize) || 12
  const w = Math.ceil((PAD + size * 8) * SS)
  const h = Math.ceil(size * 3 * SS)
  const readW = Math.ceil((PAD + size * 2) * SS)
  const cv = ctx.canvas
  if (cv.width !== w || cv.height !== h) {
    cv.width = w
    cv.height = h
  }
  ctx.setTransform(SS, 0, 0, SS, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#fff'
  ctx.fillText(el.textContent ?? '', PAD, size * 1.6)
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, readW, h).data
  } catch {
    return 0
  }
  for (let px = 0; px < readW; px += 1) {
    for (let py = 0; py < h; py += 1) {
      if ((data[(py * readW + px) * 4 + 3] ?? 0) > 8) return px / SS - PAD
    }
  }
  return 0
}

/** Pad every count in one row so they all land `GAP` from their circle. */
export function alignCounts(row: HTMLElement | null): void {
  if (row === null || context() === null) return
  const counts = row.querySelectorAll<HTMLElement>('.action-num')
  if (counts.length === 0) return
  const first = row.querySelector<HTMLElement>('.action')
  const base = first === null ? 0 : Number.parseFloat(getComputedStyle(first).columnGap) || 0
  for (const count of counts) {
    count.style.marginLeft = `${(GAP - base - bearingOf(count)).toFixed(2)}px`
  }
}
