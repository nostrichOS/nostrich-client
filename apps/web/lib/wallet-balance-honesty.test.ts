import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** A balance the wallet did not just give us must never be drawn as one it did. */
const wallet = readFileSync(join(__dirname, 'wallet.ts'), 'utf8')
const screen = readFileSync(join(__dirname, '..', 'components', 'ZapsScreen.tsx'), 'utf8')

describe('wallet balance honesty', () => {
  it('throws when the wallet does not answer, instead of returning undefined', () => {
    expect(wallet).toContain("throw new Error(res.error.code)")
    expect(wallet).not.toContain('if (!res.ok) return undefined')
  })

  it('reports staleness from isSuccess, not from data being present', () => {
    // With placeholderData, `data` is defined long before the wallet has said anything.
    expect(wallet).toContain('const stale = !query.isSuccess && query.data !== undefined')
  })

  it('labels a stale figure on screen', () => {
    expect(screen).toContain('balanceStale')
    expect(screen).toContain('Last known')
  })

  it('does not show a loading skeleton over a figure it is already displaying', () => {
    expect(wallet).toContain('loading: query.isPending && !stale && client !== undefined')
  })
})
