'use client'

import { prefersReducedMotion } from './theme'

/** A few balloons, on the anniversary of the day an account joined Nostr. */

/** HOW MANY, AND HOW BIG, DEPEND ON THE WIDTH. */
const MAX_COUNT = 11
const MIN_COUNT = 6
/** Width, in px, that one balloon is given to itself. */
const WIDTH_PER_BALLOON_NARROW = 55
const WIDTH_PER_BALLOON = 100
/** Below this the set is a phone set: fewer, smaller, and spread over a longer arrival. */
const NARROW_PX = 560
/** Clear of both edges, so nothing is half off the screen. */
const EDGE_PX = 6

/** How long to let the page settle before celebrating. */
export const SETTLE_MS = 2_500

/** Long enough to cross the viewport unhurried, and different enough that no two. */
const MIN_SECONDS = 7
const MAX_EXTRA_SECONDS = 6
/** From the first balloon leaving to the last, in seconds. */
const ARRIVAL_WINDOW_SECONDS = 7

/** WHICH LANE LEAVES WHEN, arranged so the set never reads as one moving line. */
const SHUFFLE_TRIES = 24

function scatteredLanes(count: number): number[] {
  let best: number[] | undefined
  let bestScore = Infinity
  for (let attempt = 0; attempt < SHUFFLE_TRIES; attempt += 1) {
    const lanes = Array.from({ length: count }, (_, index) => index)
    for (let index = lanes.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1))
      const held = lanes[index] as number
      lanes[index] = lanes[swap] as number
      lanes[swap] = held
    }
    const score = Math.abs(rampScore(lanes))
    if (score < bestScore) {
      bestScore = score
      best = lanes
    }
    // Flat enough to stop looking.
    if (bestScore < 0.08) break
  }
  return best ?? Array.from({ length: count }, (_, index) => index)
}

/** Pearson correlation between departure order and lane. */
function rampScore(lanes: readonly number[]): number {
  const n = lanes.length
  if (n < 3) return 0
  const mean = (n - 1) / 2
  let cov = 0
  let varSlot = 0
  let varLane = 0
  for (let index = 0; index < n; index += 1) {
    const slot = index - mean
    const lane = (lanes[index] as number) - mean
    cov += slot * lane
    varSlot += slot * slot
    varLane += lane * lane
  }
  const denominator = Math.sqrt(varSlot * varLane)
  return denominator === 0 ? 0 : cov / denominator
}

/** Where a balloon's LEFT EDGE goes, in pixels. */
export function laneLeftPx({
  width,
  band,
  lane,
  remSize,
  jitter,
}: {
  /** Viewport width in px. */
  width: number
  /** Lane width in px. */
  band: number
  lane: number
  /** The glyph's font size in rem. */
  remSize: number
  /** Offset within the lane, in px. */
  jitter: number
}): number {
  // Colour emoji draw a little wider than their font size.
  const balloonPx = remSize * 16 * 1.15
  const centre = (lane + 0.5) * band + jitter
  const rightmost = width - balloonPx - EDGE_PX
  // `Math.max` last, so a balloon wider than the screen still starts at the left edge.
  return Math.max(EDGE_PX, Math.min(rightmost, centre - balloonPx / 2))
}

let flying: HTMLElement | undefined
let timer: ReturnType<typeof setTimeout> | undefined

/** Send up one set of balloons. */
export function launchBalloons(): boolean {
  if (typeof document === 'undefined') return false
  // The setting means "do not move things".
  if (prefersReducedMotion()) return false
  if (flying !== undefined) return false

  const wrap = document.createElement('div')
  wrap.className = 'balloons'
  wrap.setAttribute('aria-hidden', 'true')

  const width = window.innerWidth || 1_024
  const narrow = width < NARROW_PX
  const perBalloon = narrow ? WIDTH_PER_BALLOON_NARROW : WIDTH_PER_BALLOON
  const count = Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(width / perBalloon)))
  /** Phone sizes, and desktop sizes. */
  const minRem = narrow ? 3.2 : 4.4
  const spreadRem = narrow ? 1.6 : 2.6

  const lanes = scatteredLanes(count)
  /** The lane width in pixels, which is what the placement below has to work inside. */
  const band = width / count

  let longest = 0
  for (let index = 0; index < count; index += 1) {
    /* Speeds alternate as well as scatter. */
    const remSize = minRem + Math.random() * spreadRem
    const half = MAX_EXTRA_SECONDS / 2
    const duration = MIN_SECONDS + (index % 2) * half + Math.random() * half
    // One slot each, taken in order, jittered.
    const slot = ARRIVAL_WINDOW_SECONDS / count
    const delay = index * slot + Math.random() * slot * 0.7
    longest = Math.max(longest, duration + delay)

    const rise = document.createElement('span')
    rise.className = 'balloon-rise'
    // Spread across the width in bands, then jittered inside the band: pure random puts.
    const lane = lanes[index] ?? index
    const jitter = (Math.random() - 0.5) * band * 0.4
    rise.style.left = `${Math.round(laneLeftPx({ width, band, lane, remSize, jitter }))}px`
    rise.style.animationDuration = `${duration}s`
    rise.style.animationDelay = `${delay}s`

    const sway = document.createElement('span')
    sway.className = 'balloon-sway'
    // Half the climb per sway, so a balloon leans one way and back on the way up.
    const swaySeconds = duration / 2
    sway.style.animationDuration = `${swaySeconds}s`
    /* A NEGATIVE delay, which starts the sway part-way through its own cycle. */
    sway.style.animationDelay = `${-(Math.random() * swaySeconds).toFixed(2)}s`
    sway.style.setProperty(
      '--balloon-drift',
      `${Math.round((Math.random() * 26 + 10) * (Math.random() < 0.5 ? -1 : 1))}px`,
    )

    const glyph = document.createElement('span')
    glyph.className = 'balloon-glyph'
    glyph.style.fontSize = `${remSize.toFixed(2)}rem`
    glyph.style.filter = `hue-rotate(${Math.round(Math.random() * 360)}deg)`
    glyph.textContent = '🎈'

    sway.append(glyph)
    rise.append(sway)
    wrap.append(rise)
  }

  document.body.append(wrap)
  flying = wrap
  guard(wrap)

  // Removed rather than left parked off-screen: five elements with running animations.
  timer = setTimeout(() => {
    timer = undefined
    watching?.disconnect()
    watching = undefined
    if (flying === wrap) flying = undefined
    wrap.remove()
  }, longest * 1_000 + 400)

  return true
}

/** PUT THEM BACK IF SOMETHING TAKES THEM DOWN. */
const MAX_REATTACHES = 5

function guard(wrap: HTMLElement): void {
  let attempts = 0
  const observer = new MutationObserver(() => {
    if (flying !== wrap) {
      observer.disconnect()
      return
    }
    // `document.body` is re-read every time: a recovering root can replace the element.
    if (document.body.contains(wrap)) return
    if (attempts >= MAX_REATTACHES) {
      observer.disconnect()
      return
    }
    attempts += 1
    document.body.append(wrap)
  })
  // On <html> rather than on <body>, and subtree, for the same reason: an observer.
  observer.observe(document.documentElement, { childList: true, subtree: true })
  watching = observer
}

let watching: MutationObserver | undefined
