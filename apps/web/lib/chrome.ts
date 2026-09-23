'use client'

import { useEffect } from 'react'

/** Hides the phone's navigation chrome while the reader is scrolling down. */

/** The surfaces the chrome hides on: the ones you READ. */
const READING: readonly string[] = [
  '/', // the home timeline
  '/e', // a note and its thread, including replies
  '/p', // a profile's timeline
  '/explore',
  '/articles',
  '/reads',
  '/news',
  '/notifications',
  '/history',
  '/zaps',
]

/** Whether the phone's chrome should hide while scrolling this route. */
export function hidesChrome(pathname: string): boolean {
  if (pathname === '/') return true
  return READING.some(prefix => prefix !== '/' && (pathname === prefix || pathname.startsWith(`${prefix}/`)))
}

/** NO THRESHOLD ANY MORE, and this is why it could go. */

/** How long a scroll must be over before a half-hidden bar picks an end. */
const SETTLE_MS = 120

/** Still frames before the loop gives up and lets the settle finish the job. */
const IDLE_FRAMES = 12

/** Which way the reader was last going. */
let heading: 1 | -1 = 1

/** How far the reader must actually travel before the logo bar answers. */
const PEEK_IN_PX = 24
const PEEK_OUT_PX = 40

/** Distance run in each direction since the last turn. */
let up = 0
let down = 0

/** Near the top the chrome is always shown. */
const REVEAL_ABOVE = 8

/** The longest a restore may hold the bars still without saying it has finished. */
const RESTORE_GUARD_MS = 8_000

/** Whether the bars are hidden RIGHT NOW, and the scroll position the last decision. */
let hidden = false
let lastY = 0
/** False on the surfaces that keep their nav, so a restore there cannot hide. */
let watching = false
/** True while a feed restore is moving the page. */
let restoring = false
let guard: ReturnType<typeof setTimeout> | undefined

/** ONE BLOCK, ONE SPEED. */
let travelPx = 0
let headerPx = 0

function publishTravel(): void {
  /* CACHED, because this reads geometry and the caller runs mid-scroll. */
  if (travelPx > 0) return
  const root = document.documentElement
  const header = document.querySelector('.chrome-top')?.getBoundingClientRect().height ?? 0
  const tabs = document.querySelector('.chrome-tabs')?.getBoundingClientRect().height ?? 0
  headerPx = header
  // A route with no tab strip travels the header's own height, and nothing overshoots.
  travelPx = header + tabs
  if (travelPx > 0) root.style.setProperty('--chrome-travel', `${travelPx}px`)
}

/** The strip appears and disappears with the route, and rotating the phone changes. */
function forgetTravel(): void {
  travelPx = 0
  headerPx = 0
}

/** THE LOGO BAR COMES BACK THE MOMENT YOU SCROLL UP. */
function peek(state: 'in' | 'out' | undefined): void {
  const root = document.documentElement
  const now = root.dataset['chromePeek']
  if (now === state) return
  /* "Slide away" means nothing to a bar that is not pinned. */
  if (state === 'out' && now === undefined) return
  if (peekTimer !== undefined) clearTimeout(peekTimer)
  peekTimer = undefined
  if (state === undefined) {
    delete root.dataset['chromePeek']
    return
  }
  root.dataset['chromePeek'] = state
  if (state === 'out') {
    // Long enough for the 200ms slide in globals.css, then back to being page content.
    peekTimer = setTimeout(() => {
      peekTimer = undefined
      if (root.dataset['chromePeek'] === 'out') delete root.dataset['chromePeek']
    }, 240)
  }
}

let peekTimer: ReturnType<typeof setTimeout> | undefined

/** HOW FAR THE CHROME IS PUT AWAY, 0 to 1. */
let progress = 0

function setProgress(next: number): void {
  const clamped = next < 0 ? 0 : next > 1 ? 1 : next
  if (clamped === progress) return
  progress = clamped
  const root = document.documentElement
  root.style.setProperty('--chrome-p', String(clamped))
  /* The attribute is now BOOKKEEPING, not the animation. */
  if (clamped >= 1 && !hidden) {
    hidden = true
    root.dataset['chrome'] = 'hidden'
  } else if (clamped <= 0 && hidden) {
    hidden = false
    delete root.dataset['chrome']
  }
}

function apply(next: boolean): void {
  publishTravel()
  settle(0)
  // A restore or a jump to the top decides the header's position itself.
  peek(undefined)
  setProgress(next ? 1 : 0)
}

let settling: ReturnType<typeof setTimeout> | undefined

/** A BAR LEFT HALF WAY PICKS AN END once the scrolling stops. */
function settle(after: number): void {
  if (settling !== undefined) clearTimeout(settling)
  settling = undefined
  const root = document.documentElement
  if (after === 0) {
    delete root.dataset['chromeSettle']
    return
  }
  settling = setTimeout(() => {
    settling = undefined
    if (progress <= 0 || progress >= 1) return
    root.dataset['chromeSettle'] = ''
    setProgress(heading > 0 ? 1 : 0)
    // Long enough for the 160ms transition in globals.css, then back to tracking.
    setTimeout(() => delete root.dataset['chromeSettle'], 200)
  }, after)
}

/** What a feed records alongside its scroll position, so the return trip can put. */
export function isChromeHidden(): boolean {
  return hidden
}

/** PUT THE CHROME BACK WHERE THE READER LEFT IT, in one frame and without animating. */
export function beginChromeRestore(shouldHide: boolean, baselineY: number): void {
  if (!watching) return
  // Measured from where they WERE, not from the top the router left us.
  lastY = Math.max(0, baselineY)
  restoring = true
  if (guard !== undefined) clearTimeout(guard)
  guard = setTimeout(endChromeRestore, RESTORE_GUARD_MS)

  if (shouldHide === hidden) return
  const root = document.documentElement
  root.dataset['chromeSnap'] = ''
  apply(shouldHide)
  // The reflow is the point.
  void root.offsetHeight
  delete root.dataset['chromeSnap']
}

/** The restore is over: start reading scroll as the reader again. */
export function endChromeRestore(): void {
  if (guard !== undefined) clearTimeout(guard)
  guard = undefined
  restoring = false
  const y = Math.max(0, window.scrollY)
  lastY = y
  if (y <= REVEAL_ABOVE && hidden) apply(false)
}

/** Call once, from the shell. */
export function useChromeAutoHide(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      watching = false
      delete document.documentElement.dataset['chromeScrolls']
      apply(false)
      return
    }
    watching = true
    /* READING SURFACES SCROLL THEIR HEADER AWAY AS PAGE CONTENT. */
    document.documentElement.dataset['chromeScrolls'] = ''
    lastY = Math.max(0, window.scrollY)
    let looping = false

    const measure = (): boolean => {
      // Clamped: iOS reports a negative scrollY while rubber-banding at the top.
      const y = Math.max(0, window.scrollY)
      const delta = y - lastY

      // The app moving the page is not the reader scrolling.
      if (restoring) {
        lastY = y
        return false
      }
      lastY = y
      /* The top of the feed always shows the chrome. */
      if (y <= REVEAL_ABOVE) {
        settle(0)
        // Near the top the header is visible as page content.
        peek(undefined)
        const moved = progress !== 0
        setProgress(0)
        return moved
      }
      publishTravel()
      if (travelPx <= 0) return false
      /* PROPORTIONAL. Scrolling down 30px of a 116px bar puts it 30px away, not "away". */
      // Zero deltas leave the heading alone: a scroll that pauses has not changed its mind.
      if (delta > 0) heading = 1
      else if (delta < 0) heading = -1
      /* SUSTAINED movement, not the sign of one frame's delta. */
      if (delta < 0) {
        up -= delta
        down = 0
      } else if (delta > 0) {
        down += delta
        up = 0
      }
      if (headerPx > 0 && y > headerPx) {
        if (up >= PEEK_IN_PX) peek('in')
        else if (down >= PEEK_OUT_PX) peek('out')
      }
      const before = progress
      setProgress(progress + delta / travelPx)
      // Half a bar left on screen is not a resting state.
      settle(SETTLE_MS)
      return progress !== before
    }

    /** A FRAME LOOP, NOT AN EVENT HANDLER. */
    let idle = 0
    const frame = (): void => {
      if (!looping) return
      const moved = measure()
      idle = moved ? 0 : idle + 1
      if (idle > IDLE_FRAMES) {
        looping = false
        return
      }
      requestAnimationFrame(frame)
    }

    const onScroll = (): void => {
      idle = 0
      if (looping) return
      looping = true
      requestAnimationFrame(frame)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', forgetTravel)
    // A route change swaps the tab strip in or out, and `enabled` re-runs this effect.
    forgetTravel()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', forgetTravel)
      watching = false
      // A restore latch outliving the surface it was armed on would leave the bars deaf.
      if (guard !== undefined) clearTimeout(guard)
      guard = undefined
      restoring = false
      delete document.documentElement.dataset['chromeScrolls']
      // Leaving the attribute behind would strand the chrome off-screen on a route.
      apply(false)
    }
  }, [enabled])
}
