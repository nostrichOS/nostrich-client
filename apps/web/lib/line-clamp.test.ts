import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** `line-clamp-*` AND `block` ON THE SAME ELEMENT IS ALWAYS A BUG. */

const COMPONENTS = join(import.meta.dirname, '..', 'components')

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

describe('line-clamp', () => {
  it('is never paired with a display utility that overrides it', () => {
    // `flex`, `grid` and `inline` break it exactly as `block` does, and for the same.
    const conflict = /line-clamp-\d+[^"'`]*?\b(block|inline-block|inline|flex|grid)\b|\b(block|inline-block|inline|flex|grid)\b[^"'`]*?line-clamp-\d+/
    const offenders = tsxFiles(COMPONENTS).flatMap(path => {
      const lines = readFileSync(path, 'utf8').split('\n')
      return lines.flatMap((line, i) =>
        conflict.test(line) ? [`${path.split('/').slice(-1)[0]}:${i + 1} ${line.trim().slice(0, 100)}`] : [],
      )
    })
    expect(offenders).toEqual([])
  })
})
