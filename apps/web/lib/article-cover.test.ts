import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** EVERY ARTICLE COVER GOES THROUGH `ArticleCover`. */

const COMPONENTS = join(import.meta.dirname, '..', 'components')

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

/** The six components that draw an article's `image` tag. */
const CALL_SITES = [
  'ArticleCard.tsx',
  'ArticleScreen.tsx',
  'ExploreTabs.tsx',
  'LatestArticles.tsx',
  'NewsScreen.tsx',
  'ProfileScreen.tsx',
]

/** The names an article's cover URL is held under at those call sites. */
const COVER_SOURCE = /src=\{\s*(article\.image|image)\s*\}/

describe('article covers', () => {
  it('are never rendered as a bare <img>', () => {
    const offenders = tsxFiles(COMPONENTS)
      .filter(path => CALL_SITES.includes(path.split('/').slice(-1)[0] ?? ''))
      .flatMap(path => {
        const lines = readFileSync(path, 'utf8').split('\n')
        return lines.flatMap((line, i) =>
          COVER_SOURCE.test(line)
            ? [`${path.split('/').slice(-1)[0]}:${i + 1} ${line.trim().slice(0, 100)}`]
            : [],
        )
      })
    expect(offenders).toEqual([])
  })

  it('all six call sites import the shared component', () => {
    const importing = tsxFiles(COMPONENTS)
      .filter(path => readFileSync(path, 'utf8').includes("from './ArticleCover'"))
      .map(path => path.split('/').slice(-1)[0])
      .sort()
    expect(importing).toEqual(CALL_SITES)
  })
})
