import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** "If I'm on notifications and I switch, it first loads the other account's. */
const rail = readFileSync(join(__dirname, '..', 'components', 'LeftRail.tsx'), 'utf8')

describe('an account switch navigates before it adopts', () => {
  it('no longer switches and then pushes in the same breath', () => {
    expect(rail).not.toContain('switchTo(account.pubkey)\n                      close()')
  })

  it('parks the pubkey and applies it once Home is on screen', () => {
    expect(rail).toContain('pending.current = account.pubkey')
    expect(rail).toContain("if (pending.current === null || pathname !== '/') return")
  })

  it('switches immediately when already where the switch would land', () => {
    // Nothing to wait for on Home, and a deck is per-account so it is the deliberate.
    expect(rail).toContain("if (pathname === '/' || pathname.startsWith('/deck')) {")
  })

  it('has a deadline, so a navigation that never lands cannot strand the reader', () => {
    expect(rail).toContain('SWITCH_DEADLINE_MS')
    expect(rail).toContain('deadline.current = setTimeout(')
  })

  it('clears the deadline once the switch has happened', () => {
    // Otherwise a later, unrelated switch could be undone by a stale timer.
    expect(rail).toContain('if (deadline.current !== undefined) clearTimeout(deadline.current)')
  })

  it('leaves the native shell path alone, the app switches where the keys are', () => {
    expect(rail).toContain('nativeShellSwitch(account.pubkey)')
  })
})
