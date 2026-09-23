import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** A `display` RULE IN `@layer components` CANNOT BEAT A TAILWIND DISPLAY UTILITY. */

const WEB = join(import.meta.dirname, '..')
const CSS = join(WEB, 'app', 'globals.css')

/** Every Tailwind utility that sets `display`, which is every utility that can win. */
const DISPLAY_UTILITIES = [
  'block',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'inline-table',
  'inline',
  'flex',
  'grid',
  'hidden',
  'contents',
  'flow-root',
  'list-item',
  'table',
]

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

/** The body of `@layer components { … }`, found by matching its braces rather. */
function componentsLayer(source: string): string {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = css.indexOf('@layer components')
  if (start === -1) return ''
  let depth = 0
  for (let at = start; at < css.length; at += 1) {
    if (css[at] === '{') depth += 1
    else if (css[at] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, at)
    }
  }
  return css.slice(start)
}

/** Class names in that layer whose rule sets `display` without `!important`. */
function unprotectedDisplayClasses(layer: string): string[] {
  const found = new Set<string>()
  for (const match of layer.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1] ?? ''
    const body = match[2] ?? ''
    if (!/(^|[\s;])display\s*:/.test(body)) continue
    if (/display\s*:[^;]*!important/.test(body)) continue
    for (const name of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      if (name[1] !== undefined) found.add(name[1])
    }
  }
  return [...found]
}

describe('component-layer display rules', () => {
  it('are !important wherever the element also carries a Tailwind display utility', () => {
    const classes = unprotectedDisplayClasses(componentsLayer(readFileSync(CSS, 'utf8')))
    const offenders = tsxFiles(join(WEB, 'components')).flatMap(path => {
      const lines = readFileSync(path, 'utf8').split('\n')
      return lines.flatMap((line, index) => {
        const mine = classes.filter(name => new RegExp(`(^|[\\s"'\`])${name}([\\s"'\`]|$)`).test(line))
        if (mine.length === 0) return []
        // A variant prefix (`md:flex`) lands in the same layer, so it wins just as hard.
        const wins = DISPLAY_UTILITIES.filter(utility =>
          new RegExp(`(^|[\\s"'\`])([a-z-]+:)*${utility}([\\s"'\`]|$)`).test(line),
        )
        if (wins.length === 0) return []
        return [`${path.split('/').slice(-1)[0]}:${index + 1} .${mine[0]} vs ${wins[0]}`]
      })
    })
    expect(offenders).toEqual([])
  })

  it('hides the timeline video mute badge on touch screens with a declaration that can win', () => {
    /* The specific rule the test above exists. */
    const css = readFileSync(CSS, 'utf8')
    expect(css).toMatch(/@media \(hover: none\)[\s\S]{0,600}?\.timeline-video-mute[\s\S]{0,600}?display:\s*none\s*!important/)

    const video = readFileSync(join(WEB, 'components', 'TimelineVideo.tsx'), 'utf8')
    expect(video).toContain('timeline-video-mute')
  })
})
