'use client'

/** The canvas the zap and the like draw. */

import { prefersReducedMotion } from '../theme'

// --------------------------------------------------------------------------- Palettes.

interface Layer {
  /** `r,g,b`. */
  c: string
  a: number
  w: number
  blur: number
  s: string
}

interface Palette {
  comp: GlobalCompositeOperation
  haze: Layer
  mid: Layer
  core: Layer
  flash: { in: string; mid: string; out: string; a1: number; a2: number }
  spark: { warm: string; hot: string; s: string; blur: number }
}

/** The bolt's ramp on a white page. */
const PALETTES: Record<'light', Palette> = {
  light: {
    comp: 'source-over',
    haze: { c: '255,178,40', a: 0.34, w: 6.5, blur: 16, s: 'rgba(250,170,30,.75)' },
    mid: { c: '246,124,12', a: 0.7, w: 2.6, blur: 8, s: 'rgba(240,120,10,.5)' },
    core: { c: '150,44,6', a: 0.92, w: 1.2, blur: 3, s: 'rgba(150,44,6,.45)' },
    flash: { in: '255,196,72', mid: '250,150,24', out: '250,140,0', a1: 0.5, a2: 0.3 },
    spark: { warm: '214,102,8', hot: '150,44,6', s: 'rgba(240,150,30,.45)', blur: 6 },
  },
}

/** The like's dots. */
const CONFETTI = ['#f4245e', '#ff6b9d', '#cc8ef5', '#7cc4ff', '#4ecfa4', '#ffc93c', '#ff8ce8']

// --------------------------------------------------------------------------- State.

interface Point {
  x: number
  y: number
}
interface Path {
  pts: Point[]
  /** Cumulative length at each point, so a fraction of the path can be traced. */
  cum: number[]
  total: number
}
interface Bolt {
  v: Path[]
  age: number
  life: number
  draw: number
  w: number
  alpha: number
  delay: number
}
interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  w: number
  k: 'warm' | 'hot'
}
interface Flash {
  x: number
  y: number
  age: number
  life: number
  r: number
}
interface Dot {
  x: number
  y: number
  a: number
  d: number
  r: number
  c: string
  age: number
  life: number
  delay: number
}
interface Ring {
  x: number
  y: number
  age: number
  life: number
  r1: number
  c: string
}

let ctx: CanvasRenderingContext2D | undefined
let width = 0
let height = 0
let running = false
let last = 0

const bolts: Bolt[] = []
const sparks: Spark[] = []
const flashes: Flash[] = []
const dots: Dot[] = []
const rings: Ring[] = []

function palette(): Palette {
  return PALETTES.light
}

/** Attach the canvas. */
export function attach(canvas: HTMLCanvasElement | undefined): void {
  if (canvas === undefined) {
    ctx = undefined
    return
  }
  const context = canvas.getContext('2d')
  if (context === null) return
  ctx = context
  resize(canvas)
}

export function resize(canvas: HTMLCanvasElement): void {
  if (ctx === undefined) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  width = window.innerWidth
  height = window.innerHeight
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function kick(): void {
  if (running || ctx === undefined) return
  running = true
  last = performance.now()
  requestAnimationFrame(loop)
}

function loop(now: number): void {
  if (ctx === undefined) {
    running = false
    return
  }
  // Clamped: a backgrounded tab hands back a delta of several seconds, which would.
  const dt = Math.min(48, now - last)
  last = now
  const pal = palette()

  ctx.clearRect(0, 0, width, height)
  ctx.globalCompositeOperation = pal.comp
  drawFlashes(dt, pal)
  drawBolts(dt, pal)
  drawSparks(dt, pal)
  ctx.globalCompositeOperation = 'source-over'
  drawConfetti(dt)

  if (bolts.length > 0 || sparks.length > 0 || flashes.length > 0 || dots.length > 0 || rings.length > 0) {
    requestAnimationFrame(loop)
    return
  }
  running = false
  ctx.clearRect(0, 0, width, height)
}

// ---------------------------------------------------------------------------.

/** Midpoint displacement: a straight line, subdivided four times, each new midpoint. */
function jag(x0: number, y0: number, angle: number, len: number, amp: number): Path {
  let pts: Point[] = [
    { x: x0, y: y0 },
    { x: x0 + Math.cos(angle) * len, y: y0 + Math.sin(angle) * len },
  ]
  for (let it = 0; it < 4; it += 1) {
    const out: Point[] = []
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i] as Point
      const b = pts[i + 1] as Point
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l = Math.hypot(dx, dy) || 1
      const off = (Math.random() - 0.5) * amp * (l / len)
      out.push(a, { x: (a.x + b.x) / 2 - (dy / l) * off, y: (a.y + b.y) / 2 + (dx / l) * off })
    }
    out.push(pts[pts.length - 1] as Point)
    pts = out
  }
  const cum = [0]
  for (let j = 1; j < pts.length; j += 1) {
    const p = pts[j] as Point
    const q = pts[j - 1] as Point
    cum.push((cum[j - 1] as number) + Math.hypot(p.x - q.x, p.y - q.y))
  }
  return { pts, cum, total: (cum[cum.length - 1] as number) || 1 }
}

function pointAt(path: Path, f: number): Point {
  const target = path.total * f
  for (let i = 1; i < path.cum.length; i += 1) {
    if ((path.cum[i] as number) >= target) {
      const prev = path.cum[i - 1] as number
      const t = (target - prev) / ((path.cum[i] as number) - prev || 1)
      const a = path.pts[i - 1] as Point
      const b = path.pts[i] as Point
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
  }
  return path.pts[path.pts.length - 1] as Point
}

/** Draw the first `p` of a path, cutting the final segment part-way so it grows. */
function tracePath(path: Path, p: number): void {
  if (ctx === undefined) return
  const target = path.total * p
  const first = path.pts[0] as Point
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < path.pts.length; i += 1) {
    const point = path.pts[i] as Point
    if ((path.cum[i] as number) <= target) {
      ctx.lineTo(point.x, point.y)
      continue
    }
    const prev = path.cum[i - 1] as number
    const t = (target - prev) / ((path.cum[i] as number) - prev || 1)
    const before = path.pts[i - 1] as Point
    ctx.lineTo(before.x + (point.x - before.x) * t, before.y + (point.y - before.y) * t)
    break
  }
  ctx.stroke()
}

function pass(layer: Layer, path: Path, p: number, a: number): void {
  if (ctx === undefined) return
  ctx.shadowColor = layer.s
  ctx.shadowBlur = layer.blur
  ctx.strokeStyle = `rgba(${layer.c},${(a * layer.a).toFixed(3)})`
  ctx.lineWidth = layer.w
  tracePath(path, p)
}

/** THREE variants per bolt, baked up front and swapped mid-flight. */
function spawnBolt(
  x: number,
  y: number,
  angle: number,
  len: number,
  opt: { amp?: number; life?: number; draw?: number; w?: number; alpha?: number; delay?: number; depth?: number } = {},
): void {
  const reduce = prefersReducedMotion()
  const amp = opt.amp ?? len * 0.3
  const v = [jag(x, y, angle, len, amp), jag(x, y, angle, len, amp), jag(x, y, angle, len, amp)]
  bolts.push({
    v,
    age: 0,
    life: opt.life ?? 340,
    draw: opt.draw ?? 80,
    w: opt.w ?? 1.6,
    alpha: opt.alpha ?? 1,
    delay: opt.delay ?? 0,
  })

  // Branches, one level deep.
  const depth = opt.depth ?? 0
  if (reduce || depth >= 1 || len <= 34) return
  const n = Math.random() < 0.78 ? (Math.random() < 0.4 ? 2 : 1) : 0
  for (let i = 0; i < n; i += 1) {
    const p = pointAt(v[0] as Path, 0.35 + Math.random() * 0.4)
    spawnBolt(
      p.x,
      p.y,
      angle + (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.6),
      len * (0.32 + Math.random() * 0.26),
      {
        w: (opt.w ?? 1.6) * 0.62,
        life: (opt.life ?? 340) * 0.8,
        draw: 55,
        alpha: 0.75,
        depth: depth + 1,
        delay: (opt.delay ?? 0) + 40,
      },
    )
  }
}

function drawBolts(dt: number, pal: Palette): void {
  if (ctx === undefined) return
  const reduce = prefersReducedMotion()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = bolts.length - 1; i >= 0; i -= 1) {
    const b = bolts[i] as Bolt
    b.age += dt
    if (b.age < b.delay) continue

    const age = b.age - b.delay
    const t = age / b.life
    if (t >= 1) {
      bolts.splice(i, 1)
      continue
    }

    const p = Math.min(1, age / b.draw)
    // Hold full brightness for the first third, then fall away.
    const fade = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65
    const jitter = reduce ? 1 : 0.58 + Math.random() * 0.42
    const a = Math.max(0, fade) * b.alpha * jitter
    const path = b.v[reduce ? 0 : Math.floor(age / 45) % 3] as Path

    pass({ ...pal.haze, w: b.w * pal.haze.w }, path, p, a)
    pass({ ...pal.mid, w: b.w * pal.mid.w }, path, p, a)
    pass({ ...pal.core, w: b.w * pal.core.w }, path, p, a)
  }
  ctx.shadowBlur = 0
}

function drawSparks(dt: number, pal: Palette): void {
  if (ctx === undefined) return
  // Frames, not milliseconds: the physics constants below were tuned at 60fps.
  const f = dt / 16.67
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const s = sparks[i] as Spark
    s.age += dt
    if (s.age >= s.life) {
      sparks.splice(i, 1)
      continue
    }
    s.vy += 0.055 * f
    s.vx *= 0.985
    s.vy *= 0.985
    const px = s.x
    const py = s.y
    s.x += s.vx * f
    s.y += s.vy * f
    const a = 1 - s.age / s.life
    ctx.shadowColor = pal.spark.s
    ctx.shadowBlur = pal.spark.blur
    ctx.strokeStyle = `rgba(${pal.spark[s.k]},${a.toFixed(3)})`
    ctx.lineWidth = s.w
    ctx.beginPath()
    // Drawn as the segment it travelled this frame, which is what gives it a tail for free.
    ctx.moveTo(px, py)
    ctx.lineTo(s.x, s.y)
    ctx.stroke()
  }
  ctx.shadowBlur = 0
}

function drawFlashes(dt: number, pal: Palette): void {
  if (ctx === undefined) return
  for (let i = flashes.length - 1; i >= 0; i -= 1) {
    const fl = flashes[i] as Flash
    fl.age += dt
    const t = fl.age / fl.life
    if (t >= 1) {
      flashes.splice(i, 1)
      continue
    }
    const r = fl.r * (0.35 + t * 1.55)
    // Quadratic falloff: a linear one stays visible far too long at the edge.
    const a = (1 - t) * (1 - t)
    const g = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, r)
    g.addColorStop(0, `rgba(${pal.flash.in},${(pal.flash.a1 * a).toFixed(3)})`)
    g.addColorStop(0.35, `rgba(${pal.flash.mid},${(pal.flash.a2 * a).toFixed(3)})`)
    g.addColorStop(1, `rgba(${pal.flash.out},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(fl.x, fl.y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** How big the storm is, by how big the zap. */
export const TIER_SCALE = [0, 0.3, 0.48, 0.66, 0.83, 1]

export function tierFor(sats: number): number {
  if (sats >= 5000) return 5
  if (sats >= 1000) return 4
  if (sats >= 500) return 3
  if (sats >= 100) return 2
  return 1
}

/** The discharge. */
export function fire(tier: number, x: number, y: number): void {
  if (ctx === undefined) return
  const reduce = prefersReducedMotion()
  const s = TIER_SCALE[tier] ?? 1
  const n = reduce ? 4 : Math.round(2 + 6 * s)
  const base = Math.random() * Math.PI * 2

  for (let i = 0; i < n; i += 1) {
    const a = base + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.45
    const len = 16 + 36 * s + Math.random() * (16 + 39 * s)
    spawnBolt(x, y, a, reduce ? len * 0.6 : len, {
      w: 0.75 + 0.55 * s + Math.random() * (0.45 + 0.45 * s),
      life: reduce ? 180 : 180 + 120 * s + Math.random() * (130 + 130 * s),
      draw: reduce ? 1 : 45 + 20 * s + Math.random() * (30 + 25 * s),
      depth: reduce ? 1 : 0,
    })
  }

  if (!reduce) {
    const ns = Math.round(4 + 22 * s)
    for (let i = 0; i < ns; i += 1) {
      const ang = Math.random() * Math.PI * 2
      const sp = 0.9 + 0.73 * s + Math.random() * (1.8 + 2.48 * s)
      sparks.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        // Biased upward, so the shower arcs rather than spraying evenly.
        vy: Math.sin(ang) * sp - 0.7,
        age: 0,
        life: 420 + Math.random() * 520,
        w: 0.8 + Math.random() * 1.3,
        k: Math.random() < 0.6 ? 'warm' : 'hot',
      })
    }
  }

  flashes.push({ x, y, age: 0, life: reduce ? 200 : 300, r: 14 + 22 * s })
  kick()
}

/** Small arcs while the bolt is held, so the charge looks like it is doing something. */
export function crackle(x: number, y: number, strength: number): void {
  if (ctx === undefined || prefersReducedMotion()) return
  spawnBolt(x, y, Math.random() * Math.PI * 2, 11 + Math.random() * (13 + strength * 24), {
    w: 1,
    life: 150,
    draw: 38,
    alpha: 0.85,
    depth: 1,
  })
  kick()
}

// --------------------------------------------------------------------------- Confetti.

/** Seven spokes of two dots, plus a ring. */
export function confetti(x: number, y: number): void {
  if (ctx === undefined) return
  const reduce = prefersReducedMotion()
  const tint =
    (typeof document !== 'undefined' &&
      getComputedStyle(document.documentElement).getPropertyValue('--color-like').trim()) ||
    '#f4245e'

  rings.push({ x, y, age: 0, life: reduce ? 260 : 440, r1: reduce ? 19 : 27, c: tint })

  if (!reduce) {
    const spokes = 7
    const base = -Math.PI / 2 + Math.random() * 0.5
    for (let i = 0; i < spokes; i += 1) {
      const a = base + (i / spokes) * Math.PI * 2
      for (let k = 0; k < 2; k += 1) {
        dots.push({
          x,
          y,
          a: a + (k ? 0.27 : -0.05),
          d: (k ? 19 : 26) + Math.random() * 6,
          r: (k ? 2.3 : 3) + Math.random() * 0.8,
          c: CONFETTI[(i * 2 + k) % CONFETTI.length] as string,
          age: 0,
          life: 560 + Math.random() * 160,
          delay: k ? 45 : 0,
        })
      }
    }
  }
  kick()
}

function drawConfetti(dt: number): void {
  if (ctx === undefined) return

  for (let i = rings.length - 1; i >= 0; i -= 1) {
    const e = rings[i] as Ring
    e.age += dt
    const t = e.age / e.life
    if (t >= 1) {
      rings.splice(i, 1)
      continue
    }
    const ease = 1 - Math.pow(1 - t, 3)
    const r = 2 + (e.r1 - 2) * ease
    // Starts as a filled disc.
    const lw = t < 0.3 ? r * 1.9 : Math.max(0.5, r * (0.85 - t * 0.8))
    ctx.globalAlpha = (1 - t) * 0.9
    ctx.strokeStyle = e.c
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.arc(e.x, e.y, Math.max(0.6, r - lw / 2), 0, Math.PI * 2)
    ctx.stroke()
  }

  for (let i = dots.length - 1; i >= 0; i -= 1) {
    const e = dots[i] as Dot
    e.age += dt
    if (e.age < e.delay) continue
    const t = (e.age - e.delay) / e.life
    if (t >= 1) {
      dots.splice(i, 1)
      continue
    }
    const out = 1 - Math.pow(1 - t, 2.6)
    // Swell for the first third, then shrink away.
    const s = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7
    ctx.globalAlpha = Math.max(0, Math.min(1, s * 1.3))
    ctx.fillStyle = e.c
    ctx.beginPath()
    ctx.arc(e.x + Math.cos(e.a) * e.d * out, e.y + Math.sin(e.a) * e.d * out, Math.max(0.1, e.r * s), 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.globalAlpha = 1
}

/** Test seam: how much is in flight right now. */
export function particleCount(): number {
  return bolts.length + sparks.length + flashes.length + dots.length + rings.length
}
