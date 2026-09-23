'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { ArticleCover } from './ArticleCover'
import { articleScore, rankArticles } from '../lib/article-ranking'
import { Link } from './AppLink'
import { KINDS, parseLongForm, profileDisplayName, type NostrEvent, type ParsedLongForm, type Hex } from '@nostrich/nostr'

import { absoluteDate } from '../lib/format'
import { useInteractions, type ZapDetail } from '../lib/interactions'
import {
  NO_UNTIL,
  newsArticlesQuery,
  publishedAt,
  readArticleLanguage,
  useChartArticles,
  withChartArticles,
  type ArticleEntry,
} from '../lib/news-articles'
import type { NoteCounts } from '@nostrich/app'
import { InteractionBar } from './InteractionBar'
import { LANGUAGE_LABELS, detectLanguage, matchesLanguage, type LanguageCode } from '../lib/language'
import { useProfileGate } from '../lib/quality'
import { PAGE, PAGE_TITLE } from '../lib/styles'
import { useProfile } from '../lib/profiles'
import { Avatar } from './Avatar'
import { useNowSeconds } from './Clock'
import { writeScoped } from '../lib/scope'
import { NEWS_LANGUAGE_KEY as LANGUAGE_KEY } from '../lib/settings-keys'

/** Long-form articles. */

/** How many long-form events to ask each relay. */

/** The first page, since `undefined` cannot appear in a react-query key. */

/** Articles one author may contribute to a MIXED list. */
const MIXED_FEED_CAP = 8

/** Below this many articles left, the cap is dropped rather than applied. */
const CAP_NEEDS = 5

function capPerAuthor<T extends { event: NostrEvent }>(list: T[], cap: number): T[] {
  if (!Number.isFinite(cap)) return list
  const used = new Map<string, number>()
  const out: T[] = []
  for (const entry of list) {
    const count = used.get(entry.event.pubkey) ?? 0
    if (count >= cap) continue
    used.set(entry.event.pubkey, count + 1)
    out.push(entry)
  }
  // Capping must never be the reason a page looks empty.
  return out.length >= CAP_NEEDS || out.length === list.length ? out : list
}

/** The same author, never twice within ten rows. */
const AUTHOR_GAP = 10

function spreadByAuthor<T extends { event: NostrEvent }>(list: T[]): T[] {
  const remaining = [...list]
  const out: T[] = []
  // Authors of the last `AUTHOR_GAP` rows placed.
  const recent: string[] = []

  while (remaining.length > 0) {
    let index = remaining.findIndex(entry => !recent.includes(entry.event.pubkey))
    // Everyone left was placed recently.
    if (index === -1) index = 0
    const [picked] = remaining.splice(index, 1)
    if (picked === undefined) break
    out.push(picked)
    recent.push(picked.event.pubkey)
    if (recent.length > AUTHOR_GAP) recent.shift()
  }
  return out
}

/** Roughly how long this takes to read, in minutes. */
function readingMinutes(content: string, knownWords?: number): number {
  // The chart ships a 400-character preview and the true word count beside.
  if (knownWords !== undefined && knownWords > 0) return Math.max(1, Math.round(knownWords / 200))
  const words = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#*_`>|-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 0).length
  return Math.max(1, Math.round(words / 200))
}

/** How many more chart rows each scroll to the bottom reveals. */
const CHART_PAGE = 30

/** `published_at` is optional in NIP-23. */

type SortId = 'latest' | 'trending'

type WindowId = '24h' | '1w' | '1m' | '1y' | 'all'

/** `all` is zero rather than a very large number, so the cutoff arithmetic has one. */
const WINDOWS: { id: WindowId; label: string; seconds: number }[] = [
  { id: '24h', label: 'Last 24 hours', seconds: 86_400 },
  { id: '1w', label: 'Last week', seconds: 7 * 86_400 },
  { id: '1m', label: 'Last month', seconds: 30 * 86_400 },
  { id: '1y', label: 'Last year', seconds: 365 * 86_400 },
  { id: 'all', label: 'All time', seconds: 0 },
]

/** Shared instance, so an empty result does not change identity on every render. */
const NO_ARTICLES: { event: NostrEvent; article: ParsedLongForm }[] = []

export function NewsScreen(): React.ReactNode {
  const [query, setQuery] = useState('')
  /** Most interactions, over the last 24 hours. */
  const [sort, setSort] = useState<SortId>('trending')
  /** A MONTH, not a day. */
  const [window, setWindow] = useState<WindowId>('1m')
  /** The reader's language, remembered. */
  const [language, setLanguage] = useState<LanguageCode | 'all'>('en')
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    const stored = readArticleLanguage()
    if (stored !== undefined) setLanguage(stored)
  }, [])

  const chooseLanguage = useCallback((value: LanguageCode | 'all'): void => {
    setLanguage(value)
    writeScoped(LANGUAGE_KEY, value)
  }, [])

  /** Cached across navigations, not refetched on every visit. */
  /** How far back the page has asked. */
  const [until, setUntil] = useState<number>(NO_UNTIL)

  const articlesQuery = useQuery(newsArticlesQuery(until))

  /** Every page seen so far, not just the newest one. */
  const seenRef = useRef(new Map<string, { event: NostrEvent; article: ParsedLongForm }>())
  const [accumulated, setAccumulated] = useState<{ event: NostrEvent; article: ParsedLongForm }[]>(
    NO_ARTICLES,
  )

  const page = articlesQuery.data
  useEffect(() => {
    if (page === undefined) return
    const held = seenRef.current
    let changed = false
    for (const entry of page) {
      const previous = held.get(entry.article.address)
      if (previous === undefined || entry.event.created_at > previous.event.created_at) {
        held.set(entry.article.address, entry)
        changed = true
      }
    }
    if (!changed) return
    setAccumulated([...held.values()].sort((a, b) => publishedAt(b) - publishedAt(a)))
  }, [page])

  const relayArticles = accumulated

  /** Older articles, fetched when the reader reaches the bottom. */
  const [exhausted, setExhausted] = useState(false)
  /** How much of the CHART is on screen, grown as the reader reaches the bottom. */
  const [revealed, setRevealed] = useState(CHART_PAGE)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const oldestRef = useRef<number>(NO_UNTIL)
  // The RELAY list, not the merged one: paging asks relays for what is older.
  oldestRef.current =
    relayArticles.length === 0
      ? NO_UNTIL
      : (publishedAt(relayArticles[relayArticles.length - 1] as never) ?? 0)

  const heldRef = useRef(0)
  useEffect(() => {
    if (page === undefined) return
    // Nothing new in this page means the window below is empty.
    if (relayArticles.length === heldRef.current && until !== NO_UNTIL) setExhausted(true)
    heldRef.current = relayArticles.length
  }, [page, relayArticles.length, until])

  const fetchingRef = useRef(false)
  fetchingRef.current = articlesQuery.isFetching
  // Read inside the IntersectionObserver, which is created.
  const chartRef = useRef(false)

  useEffect(() => {
    const node = sentinelRef.current
    if (node === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (entry === undefined || !entry.isIntersecting) return
        /* ON THE CHART, THE BOTTOM REVEALS MORE OF WHAT WE ALREADY. */
        if (chartRef.current) {
          setRevealed(shown => shown + CHART_PAGE)
          return
        }
        if (fetchingRef.current || exhausted) return
        const oldest = oldestRef.current
        if (oldest === NO_UNTIL) return
        setUntil(oldest - 1)
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [exhausted])
  // Only the FIRST load shows a skeleton.
  const loading = articlesQuery.isPending

  // Same gate as the timeline: the author's NIP-05 must resolve back to their own pubkey.
  /** THE SERVER'S ARTICLES CHART. */
  const chart = useChartArticles()
  const charted = chart.entries
  /** True word counts for the previews, so "x min read" is about the piece. */
  const chartWords = chart.words
  /** The chart's rank for each article, and the set of ids. */
  const chartRank = chart.rank

  /** The chart's articles are ADDED to whatever the relays returned, never substituted. */
  const articles = useMemo(() => withChartArticles(relayArticles, charted), [relayArticles, charted])

  const events = useMemo(() => articles.map(entry => entry.event), [articles])
  const gate = useProfileGate(events, { enabled: true, requireNip05: true })
  const passing = useMemo(
    () => articles.filter(entry => gate.accepts(entry.event)),
    [articles, gate],
  )

  const visible = passing
  /** THE SKELETON WAITS FOR THE FIRST ARTICLE, not for the last verification. */
  const busy = (loading || gate.settling) && visible.length === 0

  /** Language is detected once per article and cached by address, not recomputed. */
  const languages = useMemo(() => {
    const map = new Map<string, LanguageCode>()
    for (const entry of visible) {
      map.set(
        entry.article.address,
        detectLanguage(`${entry.article.title ?? ''} ${entry.article.summary ?? ''} ${entry.article.content}`),
      )
    }
    return map
  }, [visible])

  /** Whether the ranked chart is what the reader is looking. */
  const usingChart = sort === 'trending' && charted.length > 0
  chartRef.current = usingChart

  const now = useNowSeconds()

  /** Every filter EXCEPT the language choice: the date window, then the search term. */
  const base = useMemo(() => {
    let list = visible

    /* THE CHART CARRIES ITS OWN WINDOW, so the date filter steps aside. */
    const seconds =
      usingChart ? 0 : (WINDOWS.find(entry => entry.id === window)?.seconds ?? 0)
    /* FILTERED FROM THE FIRST PAINT, using the local clock until the shared one ticks. */
    const at = now > 0 ? now : Math.floor(Date.now() / 1000)
    if (seconds > 0 && at > 0) {
      const cutoff = at - seconds
      list = list.filter(entry => publishedAt(entry) >= cutoff)
    }

    const term = query.trim().toLowerCase()
    if (term !== '') {
      list = list.filter(entry =>
        `${entry.article.title ?? ''} ${entry.article.summary ?? ''} ${entry.article.content}`
          .toLowerCase()
          .includes(term),
      )
    }

    return list
  }, [visible, window, now, query, usingChart])

  /** The language rows, counted under whatever else is already filtering the list. */
  const available = useMemo((): [LanguageCode, number][] => {
    // The current choice stays listed even when the window empties it, at zero.
    const present = new Set<LanguageCode>(['en'])
    if (language !== 'all') present.add(language)
    for (const entry of base) {
      const code = languages.get(entry.article.address) ?? 'unknown'
      if (code !== 'unknown') present.add(code)
    }
    return [...present]
      .map((code): [LanguageCode, number] => [
        code,
        // Uncapped, because choosing a language lifts the per-author cap.
        base.filter(entry =>
          matchesLanguage(languages.get(entry.article.address) ?? 'unknown', code),
        ).length,
      ])
      .sort((a, b) => {
        if (a[0] === 'en') return -1
        if (b[0] === 'en') return 1
        return b[1] - a[1]
      })
  }, [base, languages, language])

  const eligible = useMemo(
    () =>
      capPerAuthor(
        base.filter(entry =>
          matchesLanguage(languages.get(entry.article.address) ?? 'unknown', language),
        ),
        // Always capped now, whatever the language.
        MIXED_FEED_CAP,
      ),
    [base, languages, language],
  )

  /** Zaps for every article listed, on both sorts, and by ADDRESS as well as by id. */
  const zapIds = useMemo(() => eligible.map(entry => entry.event.id), [eligible])
  const zapAddresses = useMemo(
    () => new Map(eligible.map(entry => [entry.article.address, entry.event.id as Hex])),
    [eligible],
  )
  /** FULL COUNTS, not zaps only. */
  const { counts, zaps, settled: countsSettled } = useInteractions(zapIds, { addresses: zapAddresses })

  const shown = useMemo(() => {
    /** Spread LAST, after whichever sort ran. */
    if (sort !== 'trending') return spreadByAuthor(eligible)
    /** THE SERVER'S ORDER, kept exactly, when the chart is what we are showing. */
    if (usingChart) {
      return eligible
        .filter(entry => chartRank.has(entry.event.id))
        .sort((a, b) => (chartRank.get(a.event.id) ?? 0) - (chartRank.get(b.event.id) ?? 0))
    }
    const score = (id: string): number => articleScore(counts.get(id))

    /** A ranking needs enough signal to BE a ranking. */
    return spreadByAuthor(rankArticles(eligible, entry => score(entry.event.id), publishedAt))
  }, [eligible, sort, counts, usingChart, chartRank])

  /** THE ORDER IS FIXED THE MOMENT A ROW IS DRAWN, and only a deliberate choice re-opens. */
  /* NOT FROZEN UNTIL THE THING IT IS ORDERING BY EXISTS. */
  const orderKey = `${sort}|${window}|${language}|${query.trim()}`
  /* Back to the first screenful whenever the reader changes the question. */
  useEffect(() => setRevealed(CHART_PAGE), [orderKey])
  /** Whether the order is worth freezing yet. */
  const rankable =
    sort !== 'trending' || usingChart || (!chart.loading && chart.entries.length === 0 && countsSettled)
  const slots = useRef<{ key: string; map: Map<string, number> }>({ key: '', map: new Map() })
  const stable = useMemo(() => {
    /** THE CHART NEEDS NO SLOT FREEZE, and taking one breaks its ranking. */
    if (usingChart) return shown.slice(0, revealed)
    if (!rankable) {
      // Still deciding.
      slots.current = { key: '', map: new Map() }
      return shown
    }
    if (slots.current.key !== orderKey) slots.current = { key: orderKey, map: new Map() }
    const order = slots.current.map
    for (const entry of shown) {
      if (!order.has(entry.article.address)) order.set(entry.article.address, order.size)
    }
    return [...shown].sort(
      (a, b) => (order.get(a.article.address) ?? 0) - (order.get(b.article.address) ?? 0),
    )
  }, [shown, orderKey, rankable, usingChart, revealed])

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Articles</h1>
      <div className="relative mt-4 flex gap-2">
        <label htmlFor="news-q" className="sr-only">
          Search articles
        </label>
        <input
          id="news-q"
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search articles"
          // No focus border on a search field.
          className="w-full rounded-lg border border-border bg-bg-inset py-2.5 pl-4 pr-4 text-text placeholder:text-text-faint focus:outline-none"
        />

        {/* Sliders, matching Explore's advanced-search control: the panel adjusts THIS list. */}
        <button
          type="button"
          onClick={() => setFiltersOpen(open => !open)}
          aria-label="Filter and sort"
          aria-expanded={filtersOpen}
          className={`flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors ${
            language !== 'en' || sort !== 'trending' || window !== '24h'
              ? 'border-text bg-text text-bg'
              : 'border-border text-text-muted hover:bg-bg-inset hover:text-text'
          }`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="16" cy="18" r="2" />
          </svg>
        </button>

        {filtersOpen ? (
          <FilterPanel
            sort={sort}
            window={window}
            onWindow={setWindow}
            /* The chart's window is fixed at seven days. */
            showWindow={!usingChart}
            language={language}
            available={available}
            total={capPerAuthor(base, MIXED_FEED_CAP).length}
            onSort={setSort}
            onLanguage={chooseLanguage}
            onClose={() => setFiltersOpen(false)}
          />
        ) : null}
      </div>

      <div className="-mx-4 mt-4 sm:-mx-5">
        {busy ? (
          /* Twelve rows and an avatar, matching the timeline's skeleton. */
          <ul aria-hidden="true">
            {['92%', '78%', '85%', '60%', '88%', '72%', '95%', '66%', '81%', '90%', '70%', '84%'].map(
              (width, row) => (
                <li key={row} className="border-b border-border px-4 py-5 sm:px-5">
                  <div className="flex items-center gap-2">
                    <div className="size-8 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
                    <div className="h-3 w-28 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
                  </div>
                  <div
                    className="mt-3 h-4 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none"
                    style={{ width }}
                  />
                  <div className="mt-2 h-3 w-full animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
                </li>
              ),
            )}
          </ul>
        ) : shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-text-muted sm:px-5">
            {query.trim() !== '' || language !== 'all' || window !== 'all'
              ? 'Nothing matches those filters.'
              : 'No articles from verified authors came back from your relays. Long-form is carried by fewer relays than notes, and the NIP-05 gate is strict, so adding a relay that indexes long-form would help.'}
          </p>
        ) : (
          <>
            <ul>
              {stable.map(({ event, article }) => (
                <ArticleRow
                  key={article.address}
                  event={event}
                  article={article}
                  /* THE COUNTS THE PAGE ALREADY HAS, handed to the row. */
                  counts={counts.get(event.id)}
                  {...(chartWords.has(event.id) ? { words: chartWords.get(event.id) } : {})}
                  zaps={zaps.get(event.id)}
                />
              ))}
            </ul>

            {/* The page used to simply stop. */}
            <div ref={sentinelRef} aria-hidden="true" className="h-px" />
            {usingChart ? (
              stable.length < shown.length ? null : (
                /* No count and no explanation. */
                <p className="pb-8 pt-4 text-center text-xs text-text-faint">
                  End of the articles.
                </p>
              )
            ) : articlesQuery.isFetching ? (
              <p className="pb-8 pt-4 text-center text-xs text-text-faint">Loading older articles…</p>
            ) : exhausted ? (
              <p className="pb-8 pt-4 text-center text-xs text-text-faint">
                That is everything your relays have.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function ArticleRow({
  event,
  article,
  counts,
  words,
  zaps,
}: {
  event: NostrEvent
  article: ParsedLongForm
  counts?: NoteCounts
  /** True word count, when this row is drawn from the chart's preview. */
  words?: number
  zaps?: readonly ZapDetail[]
}): React.ReactNode {
  const profile = useProfile(event.pubkey)
  const name = profileDisplayName({ ...profile, pubkey: event.pubkey })

  return (
    <li className="border-b border-border transition-colors last:border-b-0 hover:bg-bg-elevated">
      <Link href={`/e/${event.id}`} className="flex gap-4 px-4 py-5 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Avatar pubkey={event.pubkey} name={name} picture={profile?.picture} size="sm" />
            <span className="truncate">{name}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{absoluteDate(article.publishedAt ?? event.created_at)}</span>
            {/* After the date, on the same line: it is a property of the article, like its date. */}
            <span className="shrink-0 rounded-full bg-bg-inset px-2 py-0.5 text-xs text-text-muted">
              {readingMinutes(article.content, words)} min read
            </span>
          </div>

          {/* Larger than a note's text, because it is a headline and not a sentence. */}
          <h2 className="mt-2 text-xl font-bold leading-snug text-text sm:text-[22px]">
            {article.title}
          </h2>

          {article.summary !== undefined && article.summary.trim() !== '' ? (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-muted">
              {article.summary}
            </p>
          ) : (
            // No summary: show the opening of the body instead of an empty gap.
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-muted">
              {article.content.replace(/^#+\s*/gm, '').replace(/[*_`>]/g, '').slice(0, 200)}
            </p>
          )}

          {/* The same actions the timeline. */}
          <div
            className="-ml-2 mt-2 max-w-[380px]"
            onClick={clickEvent => {
              clickEvent.preventDefault()
              clickEvent.stopPropagation()
            }}
          >
            {/* NO ZAP STRIP IN THIS LIST. */}
            <InteractionBar event={event} {...(counts === undefined ? {} : { counts })} />
          </div>

          {article.hashtags.length > 0 ? (
            <p className="mt-2 flex flex-wrap gap-2">
              {article.hashtags.slice(0, 4).map(tag => (
                <span key={tag} className="rounded-lg bg-bg-inset px-2 py-0.5 text-xs text-text-muted">
                  #{tag}
                </span>
              ))}
            </p>
          ) : null}
        </div>

        {article.image !== undefined && article.image.trim() !== '' ? (
          <ArticleImage url={article.image} author={event.pubkey as Hex} />
        ) : null}
      </Link>
    </li>
  )
}

/** An article's cover art in the list. */
function ArticleImage({ url, author }: { url: string; author: Hex }): React.ReactNode {
  return (
    <ArticleCover
      url={url}
      author={author}
      className="hidden h-24 w-40 shrink-0 rounded-lg bg-bg-inset object-cover sm:block"
    />
  )
}

/** Sort, date and language, in one popover. */
function FilterPanel({
  sort,
  window,
  onWindow,
  showWindow,
  language,
  available,
  total,
  onSort,
  onLanguage,
  onClose,
}: {
  sort: SortId
  window: WindowId
  onWindow: (value: WindowId) => void
  /** False on the ranked chart, whose window is fixed at thirty days and not the reader's. */
  showWindow: boolean
  language: LanguageCode | 'all'
  available: [LanguageCode, number][]
  total: number
  onSort: (value: SortId) => void
  onLanguage: (value: LanguageCode | 'all') => void
  onClose: () => void
}): React.ReactNode {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    // Deferred a tick, or the click that opened this closes it again.
    const timer = setTimeout(() => document.addEventListener('click', onClick), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Filter and sort"
      className="absolute right-0 top-full z-50 mt-2 w-[min(280px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-lg"
    >
      <p className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        Sort by
      </p>
      {(
        [
          ['latest', 'Latest'],
          ['trending', 'Most interactions'],
        ] as [SortId, string][]
      ).map(([id, label]) => (
        <Choice key={id} label={label} selected={sort === id} onClick={() => onSort(id)} />
      ))}

      {showWindow ? (
        <>
          <p className="border-y border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
            Date posted
          </p>
          {WINDOWS.map(entry => (
            <Choice
              key={entry.id}
              label={entry.label}
              selected={window === entry.id}
              onClick={() => onWindow(entry.id)}
            />
          ))}
        </>
      ) : (
        <p className="border-y border-border px-4 py-2 text-xs text-text-faint">
          Ranked over the last <strong className="font-semibold text-text-muted">30 days</strong>,
          newer work weighted higher. Long-form is published less often than notes and read over
          weeks, so the chart uses one fixed window.
        </p>
      )}

      <p className="border-y border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
        Language
      </p>
      {/* Scrolls rather than growing the popover: the list is as long as the feed. */}
      <div className="max-h-56 overflow-y-auto">
        {available.map(([code, count]) => (
          <Choice
            key={code}
            label={LANGUAGE_LABELS[code]}
            count={count}
            selected={language === code}
            onClick={() => onLanguage(code)}
          />
        ))}
        <Choice
          label="All languages"
          count={total}
          selected={language === 'all'}
          onClick={() => onLanguage('all')}
        />
      </div>
    </div>
  )
}

function Choice({
  label,
  count,
  selected,
  onClick,
}: {
  label: string
  count?: number
  selected: boolean
  onClick: () => void
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-bg-inset"
    >
      <span className={`min-w-0 flex-1 truncate ${selected ? 'font-semibold text-text' : 'text-text-muted'}`}>
        {label}
      </span>
      {count !== undefined ? <span className="shrink-0 text-xs text-text-faint">{count}</span> : null}
      {selected ? (
        <span className="material-symbols-outlined text-[18px]! text-text" aria-hidden="true">
          check
        </span>
      ) : null}
    </button>
  )
}
