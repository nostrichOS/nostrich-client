'use client'

import { useMemo } from 'react'

import { KINDS, parseLongForm, type NostrEvent, type ParsedLongForm } from '@nostrich/nostr'

import { getCachedEvent } from './event-cache'
import { getPool } from './pool'
import { isTagSpam } from './spam'
import { ARTICLE_WINDOW_HOURS, useTrending } from './trending'
import { readScoped } from './scope'
import { NEWS_LANGUAGE_KEY } from './settings-keys'
import { LANGUAGE_LABELS, type LanguageCode } from './language'

/** The Articles page's own query, lifted out of the screen so two callers can share. */

/** One window's worth. */
export const ARTICLES_LIMIT = 200

/** The first page. */
export const NO_UNTIL = 0

export interface ArticleEntry {
  event: NostrEvent
  article: ParsedLongForm
}

export function publishedAt(entry: ArticleEntry): number {
  return entry.article.publishedAt ?? entry.event.created_at
}

/** How old a stored first page may be and still be shown while a fresh one loads. */
const CACHE_MAX_MS = 6 * 60 * 60_000

/** Only the FIRST page is worth storing. */
const CACHE_KEY = 'news-articles:first'

export function newsArticlesQuery(until: number) {
  return {
    queryKey: ['news-articles', ARTICLES_LIMIT, until] as const,
    /** The last first-page this browser saw, painted immediately. */
    placeholderData: (): ArticleEntry[] | undefined => undefined,
    queryFn: async (): Promise<ArticleEntry[]> => {
      const events = await getPool().query(
        [
          {
            kinds: [KINDS.longForm],
            limit: ARTICLES_LIMIT,
            ...(until === NO_UNTIL ? {} : { until }),
          },
        ],
        undefined,
        10_000,
      )
      // Newest revision per address wins.
      const byAddress = new Map<string, ArticleEntry>()
      for (const event of events) {
        // The quality gate the screen applies judges whether an author has a profile at all.
        if (isTagSpam(event)) continue
        const article = parseLongForm(event)
        const held = byAddress.get(article.address)
        if (held === undefined || event.created_at > held.event.created_at) {
          byAddress.set(article.address, { event, article })
        }
      }
      const ordered = [...byAddress.values()]
        // A draft with no title is not ready to be read, whatever its author intended.
        .filter(entry => (entry.article.title ?? '').trim() !== '')
        .sort((a, b) => publishedAt(b) - publishedAt(a))

      // Only the first page, and only a real answer: an empty result is far more likely.
      return ordered
    },
    staleTime: 60_000,
    gcTime: 30 * 60_000,
  }
}

/** THE SERVER'S ARTICLES CHART, as article entries. */
export interface ChartArticles {
  entries: ArticleEntry[]
  /** The chart's rank per event id, as a map rather than an array index, so the order. */
  rank: Map<string, number>
  /** True word counts, so "x min read" is about the piece and not the excerpt. */
  words: Map<string, number>
  loading: boolean
}

export function useChartArticles(): ChartArticles {
  const chart = useTrending(ARTICLE_WINDOW_HOURS, true)

  const entries = useMemo(() => {
    const out: ArticleEntry[] = []
    for (const entry of chart.entries) {
      const cached = getCachedEvent(entry.id)
      const served = entry.note
      const event =
        cached ??
        (served === undefined
          ? undefined
          : ({
              id: served.id,
              pubkey: served.pubkey,
              kind: served.kind ?? 30023,
              created_at: served.createdAt,
              content: served.content,
              tags: served.tags,
              sig: '',
            } as NostrEvent))
      if (event === undefined) continue
      out.push({ event, article: parseLongForm(event) })
    }
    return out
  }, [chart.entries])

  const rank = useMemo(() => {
    const map = new Map<string, number>()
    entries.forEach((entry, at) => map.set(entry.event.id, at))
    return map
  }, [entries])

  const words = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of chart.entries) {
      if (entry.note?.words !== undefined) map.set(entry.id, entry.note.words)
    }
    return map
  }, [chart.entries])

  return { entries, rank, words, loading: chart.loading }
}

/** The chart's articles ADDED to whatever the relays returned, never substituted. */
export function withChartArticles(
  relayArticles: readonly ArticleEntry[],
  charted: readonly ArticleEntry[],
): ArticleEntry[] {
  if (charted.length === 0) return [...relayArticles]
  const held = new Set(relayArticles.map(entry => entry.article.address))
  return [...relayArticles, ...charted.filter(entry => !held.has(entry.article.address))]
}

/** The reader's language choice for long-form, or undefined if they have never made one. */
export function readArticleLanguage(): LanguageCode | 'all' | undefined {
  try {
    const raw = readScoped(NEWS_LANGUAGE_KEY)
    if (raw === null) return undefined
    if (raw === 'all' || raw in LANGUAGE_LABELS) return raw as LanguageCode | 'all'
    return undefined
  } catch {
    return undefined
  }
}
