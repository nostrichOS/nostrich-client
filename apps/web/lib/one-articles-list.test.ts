import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** `/articles` and Explore's Articles tab must be the SAME list. */
const read = (path: string): string =>
  readFileSync(join(__dirname, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const explore = read('../components/ExploreTabs.tsx')
const news = read('../components/NewsScreen.tsx')
const shared = read('./news-articles.ts')

describe('the Articles page and the Explore tab share one list', () => {
  it('both fetch through the shared query, so neither pays for its own copy', () => {
    /* The old Explore query asked for 400 long-form events on a key nothing else used. */
    for (const source of [explore, news]) {
      expect(source).toContain('newsArticlesQuery(')
    }
    // Explore is a preview and has no paging, so it asks for the first page.
    expect(explore).toContain('newsArticlesQuery(NO_UNTIL)')
    expect(explore).not.toContain("'explore-news'")
    expect(explore).not.toContain('NEWS_LIMIT')
  })

  it('both rank by the server chart, through one implementation of it', () => {
    // Reordering a ranking after receiving it is how a page and the chart come.
    expect(shared).toContain('export function useChartArticles()')
    expect(shared).toContain('export function withChartArticles(')
    for (const source of [explore, news]) {
      expect(source).toContain('useChartArticles()')
      expect(source).toContain('withChartArticles(')
    }
    // The mapping lives in the shared module and nowhere else.
    expect(shared).toContain('useTrending(ARTICLE_WINDOW_HOURS, true)')
    expect(explore).not.toContain('useTrending(')
    expect(news).not.toContain('useTrending(')
  })

  it('both apply the same NIP-05 gate and the same language choice', () => {
    /* The language filter is the visible half of the bug: unfiltered, kind 30023. */
    for (const source of [explore, news]) {
      expect(source).toContain('requireNip05: true')
      expect(source).toContain('matchesLanguage(')
    }
    expect(shared).toContain('export function readArticleLanguage()')
    for (const source of [explore, news]) {
      expect(source).toContain('readArticleLanguage()')
    }
  })

  it('Explore reads the language choice and does not offer a second picker', () => {
    // A control that has to be kept in step with the one on the page it previews.
    expect(explore).not.toContain('writeScoped')
    expect(explore).not.toContain('LANGUAGE_LABELS')
  })
})
