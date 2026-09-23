import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** No hook may sit below the composer's signed-out return. */

const SOURCE = readFileSync(join(__dirname, '..', 'components', 'Composer.tsx'), 'utf8')

/** Comments stripped: a hook named in prose is not a hook call. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The body of `export function Composer(...)`. */
function composerBody(): string {
  /* Sliced from the RAW source and stripped afterwards, not the other way round. */
  const start = SOURCE.indexOf('export function Composer(')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = SOURCE.indexOf('\n}\n', start)
  expect(end).toBeGreaterThan(start)
  return withoutComments(SOURCE.slice(start, end))
}

describe('Composer hook order', () => {
  it('calls no hook after the signed-out return', () => {
    const body = composerBody()
    const guard = body.indexOf("if (session.status !== 'signed')")
    expect(guard).toBeGreaterThan(0)

    const after = body.slice(guard)
    /* Nested arrow functions below the return are fine. */
    const called = [...after.matchAll(/\buse[A-Z][A-Za-z0-9]*\s*\(/g)].map(hit =>
      hit[0].replace(/\s*\($/, ''),
    )
    expect(called).toEqual([])
  })

  it('still HAS the early return, or this test proves nothing', () => {
    // A guard that silently stops guarding is worse than no guard.
    expect(composerBody()).toContain("if (session.status !== 'signed')")
  })
})
