import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** SSR guards must test for the BROWSER, not for the storage global. */

const ROOTS = [join(__dirname, '..'), join(__dirname, '..', '..', '..', 'packages')]

function sources(dir: string): string[] {
  const { readdirSync } = require('node:fs') as typeof import('node:fs')
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.next', '.turbo', 'dist'].includes(entry.name)) return []
      return sources(path)
    }
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : []
  })
}

describe('SSR storage guards', () => {
  const files = ROOTS.flatMap(sources)

  it('found the source to check, so a passing run means something', () => {
    expect(files.length).toBeGreaterThan(200)
  })

  it('never guards on the storage global existing', () => {
    const offenders = files.filter(path => {
      const text = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      return (
        text.includes("typeof localStorage === 'undefined'") ||
        text.includes("typeof sessionStorage === 'undefined'")
      )
    })
    expect(offenders.map(p => p.split('/').slice(-2).join('/'))).toEqual([])
  })
})
