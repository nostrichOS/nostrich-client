import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { homePressIntent } from './home-tap'

/** ALREADY HOME -> THE TOP. ANYWHERE ELSE ->. */
describe('what a press on Home means', () => {
  it('takes you to the top when you are already there', () => {
    expect(homePressIntent(true)).toBe('top')
  })

  it('takes you back where you were from anywhere else', () => {
    expect(homePressIntent(false)).toBe('return')
  })

  it('has no state, so two presses in a row mean the same thing', () => {
    // The double-press version failed precisely here: the second press meant something.
    expect(homePressIntent(true)).toBe('top')
    expect(homePressIntent(true)).toBe('top')
  })
})

const web = join(__dirname, '..')
const read = (...parts: string[]): string => readFileSync(join(web, ...parts), 'utf8')

describe('both Home controls are wired to it', () => {
  /** The bottom bar and the rail are separate components rendering the same icon. */
  it('the bottom bar asks before scrolling', () => {
    const shell = read('components', 'AppShell.tsx')
    expect(shell).toContain('if (homePressIntent(pathname === "/") === "return") return;')
  })

  it('the rail asks the same question', () => {
    const rail = read('components', 'LeftRail.tsx')
    expect(rail).toContain("if (homePressIntent(pathname === '/') === 'return') return")
  })

  it('reveals held notes before scrolling past them', () => {
    // Reaching the top without revealing would leave the reader looking at a gap.
    const shell = read('components', 'AppShell.tsx')
    const home = shell.slice(shell.indexOf('if (item.href === "/") {'))
    expect(home.indexOf('revealUnread();')).toBeLessThan(home.indexOf('window.scrollTo({ top: 0 });'))
  })
})

