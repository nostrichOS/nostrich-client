import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { hidesChrome } from './chrome'

/** Which surfaces are allowed to slide their navigation away. */
describe('hidesChrome', () => {
  it('hides on the surfaces made of notes', () => {
    for (const path of [
      '/',
      '/e/nevent1abc',
      '/p/npub1abc',
      '/explore',
      '/explore/people',
      '/articles',
      '/news',
      '/reads',
      '/notifications',
      '/history',
      '/zaps',
    ]) {
      expect(hidesChrome(path), path).toBe(true)
    }
  })

  it('keeps the nav on everything else', () => {
    for (const path of [
      '/settings',
      '/settings?tab=relays',
      '/store',
      '/relays',
      '/login',
      '/chat',
    ]) {
      expect(hidesChrome(path), path).toBe(false)
    }
  })

  it('matches whole segments, not string prefixes', () => {
    // The trap this list is most likely to fall into a year from now.
    expect(hidesChrome('/reads')).toBe(true)
    expect(hidesChrome('/readme')).toBe(false)
    expect(hidesChrome('/newsletter')).toBe(false)
    expect(hidesChrome('/explorer')).toBe(false)
    expect(hidesChrome('/zapshop')).toBe(false)
  })
})

/** Putting the bars back after a feed restore, without the reader watching them travel. */
describe('restoring the chrome with a feed position', () => {
  const source = readFileSync(join(__dirname, 'chrome.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('keeps the state where a restore can reach it', () => {
    // Closure-scoped `hidden`/`lastY` inside the effect is where these started, and there.
    expect(source).toContain('let hidden = false')
    expect(source).toContain('let lastY = 0')
    expect(source).not.toMatch(/\n {4}let (hidden|lastY)\b/)
  })

  it('snaps rather than transitions, which is the whole fix', () => {
    /* Set the attribute, change the state, force the reflow, remove the attribute. */
    expect(source).toContain("root.dataset['chromeSnap'] = ''")
    expect(source).toContain('void root.offsetHeight')
    expect(source).toContain("delete root.dataset['chromeSnap']")
    expect(source).toMatch(/apply\(shouldHide\)\s+void root\.offsetHeight/)
  })

  it('measures the restore jump from where the reader was, not from the top', () => {
    // Without the rebase the restore's own several-hundred-pixel jump is read.
    expect(source).toContain('lastY = Math.max(0, baselineY)')
  })

  it('ignores the restore\'s own movement instead of merely rebasing from it', () => {
    /* Rebasing `lastY` alone was the first attempt and it left the bug half-fixed. */
    expect(source).toContain('if (restoring) {')
    expect(source).toContain('restoring = true')
    expect(source).toContain('restoring = false')
  })

  it('reveals again if the restore never lands', () => {
    // Hiding is a bet on a restore that has not happened yet.
    expect(source).toContain('export function endChromeRestore()')
    expect(source).toContain('if (y <= REVEAL_ABOVE && hidden) apply(false)')
    // And the latch can never outlive a restore that forgets to say it finished.
    expect(source).toContain('RESTORE_GUARD_MS')
    expect(source).toContain('guard = setTimeout(endChromeRestore, RESTORE_GUARD_MS)')
  })

  it('cannot hide the nav on a surface that keeps it', () => {
    // Settings has a feed-less layout but the restore is generic.
    expect(source).toContain('if (!watching) return')
  })
})

describe('the header and tabs are page content, not something JS moves', () => {
  const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8')
  const chrome = readFileSync(join(__dirname, 'chrome.ts'), 'utf8')
  const feed = readFileSync(join(__dirname, '..', 'components', 'FeedScreen.tsx'), 'utf8')

  /** FOUR ROUNDS OF THIS WERE SPENT ON THE WRONG QUESTION. */
  it('neither is positioned on a reading surface', () => {
    expect(css).toContain(':root[data-chrome-scrolls] .chrome-top')
    expect(css).toContain(':root[data-chrome-scrolls] .chrome-offset')
    const rule = css.slice(css.indexOf(':root[data-chrome-scrolls] .chrome-top'))
    expect(rule.slice(0, 200)).toContain('position: static')
  })

  it('and nothing transforms or fades them any more', () => {
    // The `--chrome-p` machinery still drives the bottom bar, the float and the pill.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toContain('var(--chrome-p, 0) * var(--chrome-travel')
  })

  it('only on reading surfaces, a settings page keeps its pinned header', () => {
    // Same predicate that decides whether the bars react at all.
    expect(chrome).toContain("document.documentElement.dataset['chromeScrolls'] = ''")
    expect(chrome).toContain("delete document.documentElement.dataset['chromeScrolls']")
    expect(hidesChrome('/settings')).toBe(false)
    expect(hidesChrome('/')).toBe(true)
  })

  it('the bottom bar still hides, and still with the ratio', () => {
    expect(css).toContain('transform: translateY(calc(var(--chrome-p, 0) * 100%))')
    expect(css).toContain('transform: translateY(calc(var(--chrome-p, 0) * (135px + var(--bottom-nav-inset))))')
  })

  it('the composer can no longer slide under the tabs', () => {
    /* Reported as "post composer goes under tabs sometimes, this should never happen". */
    expect(feed).toContain('className="chrome-offset sticky top-16 z-30 sm:top-0"')
    const rule = css.slice(css.indexOf(':root[data-chrome-scrolls] .chrome-top'))
    expect(rule.slice(0, 200)).toContain('.chrome-offset')
  })

  it('the desktop is untouched: the rule is inside the phone breakpoint', () => {
    const phones = css.slice(css.indexOf('@media (max-width: 639px)'))
    const end = phones.indexOf('@media (prefers-reduced-motion')
    expect(phones.slice(0, end)).toContain('data-chrome-scrolls')
  })
})

describe('the logo bar comes back on the way up, alone', () => {
  const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8')
  const chrome = readFileSync(join(__dirname, 'chrome.ts'), 'utf8')

  /** A DELIBERATE SPLIT, and it is safe for the same reason the rest of the surface. */
  it('answers a SUSTAINED run, not one frame\'s delta', () => {
    /* Reading the sign of a single delta made it flap: a momentum scroll. */
    expect(chrome).toContain('if (up >= PEEK_IN_PX) peek(\'in\')')
    expect(chrome).toContain('else if (down >= PEEK_OUT_PX) peek(\'out\')')
    expect(chrome).toContain('const PEEK_IN_PX = 24')
    expect(chrome).toContain('const PEEK_OUT_PX = 40')
  })

  it('does not run the exit on a bar that was never pinned', () => {
    // Measured: a jittery downward scroll set and expired the attribute repeatedly.
    expect(chrome).toContain("if (state === 'out' && now === undefined) return")
  })

  it('pins with sticky, never fixed, fixed feeds back into itself', () => {
    /* A fixed element leaves the flow, so pinning a 64px header makes the document 64px. */
    const rule = css.slice(css.indexOf(':root[data-chrome-scrolls][data-chrome-peek] .chrome-top'))
    expect(rule.slice(0, 200)).toContain('position: sticky')
    expect(rule.slice(0, 200)).not.toContain('position: fixed')
  })

  it('only once the header has actually left the screen', () => {
    // Below its own height it is still visible as content.
    expect(chrome).toContain('if (headerPx > 0 && y > headerPx)')
  })

  it('slides in with keyframes, because a transition has nothing to start from', () => {
    /* The bar goes from page content scrolled off the top to fixed at the top in ONE frame. */
    expect(css).toContain('animation: chrome-peek-in 200ms ease-out both')
    expect(css).toContain('@keyframes chrome-peek-in')
    expect(css).toContain('@keyframes chrome-peek-out')
  })

  it('leaves by sliding too, then drops back to being page content', () => {
    // Removing the attribute alone would swap a fixed element for a static one hundreds.
    expect(chrome).toContain("if (root.dataset['chromePeek'] === 'out') delete root.dataset['chromePeek']")
    expect(css).toContain('animation: chrome-peek-out 200ms ease-out both')
  })

  it('never floats a second copy over the real one at the top', () => {
    const near = chrome.slice(chrome.indexOf('if (y <= REVEAL_ABOVE)'))
    expect(near.slice(0, 320)).toContain('peek(undefined)')
  })

  it('and a restore decides the header itself', () => {
    // A half-finished peek over the top of a restore is the "little flash" this area.
    const apply = chrome.slice(chrome.indexOf('function apply('))
    expect(apply.slice(0, 400)).toContain('peek(undefined)')
  })

  it('reduced motion switches the arrival off in its own terms', () => {
    // It is an animation, not a transition, so the `transition: none` above cannot reach.
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
    // To the end of THAT block, rather than a guessed character count.
    const block = css.slice(start, css.indexOf('\n}', css.indexOf(':root[data-chrome-settle]', start)))
    expect(block).toContain(':root[data-chrome-peek] .chrome-top')
    expect(block).toContain('animation-duration: 1ms')
  })
})
