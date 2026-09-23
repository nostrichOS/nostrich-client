'use client'

import { Link } from './AppLink'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { profileDisplayName, type NostrEvent, type ParsedLongForm } from '@nostrich/nostr'

import {
  EXPLORE_HOURS,
  peopleFrom,
  useExploreData,
  useTopics,
  type TrendingPerson,
} from '../lib/explore'
import { npubOf } from '../lib/format'
import { detectLanguage, matchesLanguage, type LanguageCode } from '../lib/language'
import {
  NO_UNTIL,
  newsArticlesQuery,
  publishedAt,
  readArticleLanguage,
  useChartArticles,
  withChartArticles,
  type ArticleEntry,
} from '../lib/news-articles'
import { useInteractions } from '../lib/interactions'
import { InteractionBar } from './InteractionBar'
import type { NoteCounts } from '@nostrich/app'
import { useProfile } from '../lib/profiles'
import { onePerAuthor, useProfileGate } from '../lib/quality'
import { ArticleCover } from './ArticleCover'
import { Avatar } from './Avatar'
import { FollowButton } from './FollowButton'
import { NoteCard } from './NoteCard'
import { TAB_ACTIVE, TAB_CELL_TIGHT, TAB_IDLE, TAB_LABEL, TAB_STRIP, TAB_STRIP_BLEED, TAB_STRIP_ROW_TIGHT, TAB_UNDERLINE } from '../lib/styles'

/** What Explore shows when nobody has searched for anything. */

type ExploreTabId = 'trending' | 'topics' | 'people' | 'articles'

const TABS: { id: ExploreTabId; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'topics', label: 'Topics' },
  { id: 'people', label: 'People' },
  { id: 'articles', label: 'Articles' },
]

const MAX_NOTES = 40
/** Topics shown. */
const MAX_TOPICS = 50
/** People shown. */
const MAX_PEOPLE = 50

export function ExploreTabs(): React.ReactNode {
  const [tab, setTab] = useState<ExploreTabId>('trending')
  // Fetched once for the whole component, not per tab.
  const { notes, scores, loading, error } = useExploreData(true)

  const ranked = useMemo(
    /** Ranked, then flattened to one note per author. */
    () =>
      onePerAuthor([...notes].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))),
    [notes, scores],
  )
  // Its own query, not a derivative of the trending notes: see useTopics.
  const topicsQuery = useTopics(tab === 'topics', MAX_TOPICS)
  const people = useMemo(() => peopleFrom(notes, scores, MAX_PEOPLE), [notes, scores])

  return (
    <div className="mt-4">
      <div className={`${TAB_STRIP} ${TAB_STRIP_BLEED}`}>
        <div role="tablist" aria-label="Explore" className={TAB_STRIP_ROW_TIGHT}>
          {TABS.map(item => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={TAB_CELL_TIGHT}
            >
              <span className={TAB_LABEL}>
                <span className={tab === item.id ? TAB_ACTIVE : TAB_IDLE}>
                  {item.label}
                </span>
                {/* Sits under the LABEL and takes its width, rather than a fixed w-12 centred. */}
                {tab === item.id ? (
                  <span
                    aria-hidden="true"
                    className={TAB_UNDERLINE}
                  />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      {error !== null && tab !== 'articles' ? (
        <p className="px-1 py-8 text-center text-sm text-text-muted">
          The trending index is unreachable right now. Search still works, and so does the
          timeline, because both read relays directly.
        </p>
      ) : null}

      {tab === 'trending' ? (
        <TrendingList notes={ranked.slice(0, MAX_NOTES)} loading={loading} />
      ) : null}
      {tab === 'topics' ? <TopicGrid topics={topicsQuery.topics} loading={topicsQuery.loading} /> : null}
      {tab === 'people' ? <PeopleList people={people} loading={loading} /> : null}
      {tab === 'articles' ? <ArticlesList /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------.

/** Loading placeholder for every Explore tab. */
/** Shared instance, so an empty result keeps a stable identity between renders. */
const NO_ENTRIES: ArticleEntry[] = []

const SKELETON_WIDTHS = ['85%', '62%', '78%', '55%', '90%', '68%', '74%', '58%', '83%', '65%', '88%', '70%']

function Skeleton(): React.ReactNode {
  return (
    <div aria-hidden="true" className="mt-4 space-y-4 px-1">
      {SKELETON_WIDTHS.map((width, row) => (
        <div key={row} className="flex gap-3">
          <div className="size-10 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-32 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
            <div
              className="h-3 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none"
              style={{ width }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function TrendingList({ notes, loading }: { notes: NostrEvent[]; loading: boolean }): React.ReactNode {
  /** Counted, like every other note surface in the app. */
  const ids = useMemo(() => notes.map(event => event.id), [notes])
  const { counts } = useInteractions(ids)

  if (loading && notes.length === 0) return <Skeleton />
  if (notes.length === 0) {
    return <Empty>Nothing has taken off in the last {EXPLORE_HOURS} hours.</Empty>
  }
  // Negative margin so the cards run edge to edge like the timeline does, rather.
  return (
    <div className="-mx-4 sm:-mx-5">
      {notes.map(event => (
        <NoteCard key={event.id} event={event} counts={counts.get(event.id)} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------.

function TopicGrid({
  topics,
  loading,
}: {
  topics: { tag: string; notes: number }[]
  loading: boolean
}): React.ReactNode {
  if (loading && topics.length === 0) return <Skeleton />
  if (topics.length === 0) {
    return <Empty>No topic has enough behind it to be worth calling one right now.</Empty>
  }
  return (
    <>
      <p className="mt-4 text-xs text-text-faint">
        Hashtags carried by notes that got engagement in the last {EXPLORE_HOURS} hours.
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {topics.map((topic, index) => (
          <li key={topic.tag}>
            <Link
              href={`/?t=${encodeURIComponent(topic.tag)}`}
              className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-bg-inset"
            >
              <span className="w-5 shrink-0 text-sm font-semibold text-text-faint">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-text">
                  #{topic.tag}
                </span>
                <span className="block text-xs text-text-faint">
                  {topic.notes} {topic.notes === 1 ? 'note' : 'notes'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------------------------------------------------------------------------.

function PeopleList({ people, loading }: { people: TrendingPerson[]; loading: boolean }): React.ReactNode {
  if (loading && people.length === 0) return <Skeleton />
  if (people.length === 0) return <Empty>Nobody stood out in the last {EXPLORE_HOURS} hours.</Empty>
  return (
    <>
      <p className="mt-4 text-xs text-text-faint">
        Ranked by the total engagement their notes drew in the last {EXPLORE_HOURS} hours, not
        by follower count.
      </p>
      <ul className="mt-2 divide-y divide-border">
        {people.map(person => (
          <PersonRow key={person.pubkey} person={person} />
        ))}
      </ul>
    </>
  )
}

function PersonRow({ person }: { person: TrendingPerson }): React.ReactNode {
  const profile = useProfile(person.pubkey)
  const name = profileDisplayName(profile ?? { pubkey: person.pubkey })

  return (
    <li className="flex items-start gap-3 py-3">
      <Link href={`/p/${npubOf(person.pubkey)}`} className="shrink-0">
        <Avatar pubkey={person.pubkey} name={name} picture={profile?.picture} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/p/${npubOf(person.pubkey)}`} className="block min-w-0">
          <span className="block truncate text-[15px] font-semibold text-text hover:underline">
            {name}
          </span>
          <span className="block text-xs text-text-faint">
            {person.notes} trending {person.notes === 1 ? 'note' : 'notes'}
          </span>
        </Link>
        {/* Their best note of the window, so the row says why they are here rather than asking. */}
        <p className="line-clamp-2 mt-1 text-sm leading-snug text-text-muted">
          {person.top.content}
        </p>
      </div>
      <div className="shrink-0">
        <FollowButton target={person.pubkey} />
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------.

const NEWS_SHOWN = 60

/** Long-form posts. */
function ArticlesList(): React.ReactNode {
  const query = useQuery(newsArticlesQuery(NO_UNTIL))
  const chart = useChartArticles()

  const relayArticles = query.data ?? NO_ENTRIES
  const loading = query.isPending && chart.loading

  const entries = useMemo(
    () => withChartArticles(relayArticles, chart.entries),
    [relayArticles, chart.entries],
  )

  const events = useMemo(() => entries.map(entry => entry.event), [entries])
  const gate = useProfileGate(events, { enabled: true, requireNip05: true })

  /** The reader's language, as `/articles` remembers. */
  const language = useMemo((): LanguageCode | 'all' => readArticleLanguage() ?? 'en', [])

  /** Detected once per article and cached by address, not recomputed per render. */
  const languages = useMemo(() => {
    const map = new Map<string, LanguageCode>()
    if (language === 'all') return map
    for (const entry of entries) {
      map.set(
        entry.article.address,
        detectLanguage(`${entry.article.title ?? ''} ${entry.article.summary ?? ''} ${entry.article.content}`),
      )
    }
    return map
  }, [entries, language])

  const visible = useMemo(() => {
    const eligible = entries.filter(entry => {
      if (!gate.accepts(entry.event)) return false
      if (language === 'all') return true
      return matchesLanguage(languages.get(entry.article.address) ?? 'unknown', language)
    })

    /* THE SERVER'S ORDER, kept exactly, whenever the chart returned anything. */
    if (chart.entries.length > 0) {
      return eligible
        .filter(entry => chart.rank.has(entry.event.id))
        .sort((a, b) => (chart.rank.get(a.event.id) ?? 0) - (chart.rank.get(b.event.id) ?? 0))
        .slice(0, NEWS_SHOWN)
    }

    /* No chart. */
    const seen = new Set<string>()
    const out: ArticleEntry[] = []
    for (const entry of [...eligible].sort((a, b) => publishedAt(b) - publishedAt(a))) {
      if (seen.has(entry.event.pubkey)) continue
      seen.add(entry.event.pubkey)
      out.push(entry)
      if (out.length >= NEWS_SHOWN) break
    }
    return out
  }, [entries, gate, language, languages, chart.entries, chart.rank])

  // Counted for what is actually shown, not for the whole window behind.
  const shownIds = useMemo(() => visible.map(entry => entry.event.id), [visible])
  const { counts } = useInteractions(shownIds)

  if ((loading || gate.settling) && visible.length === 0) return <Skeleton />
  if (visible.length === 0) {
    return <Empty>No long-form posts from verified accounts on your relays right now.</Empty>
  }

  return (
    <>
      <p className="mt-4 text-xs text-text-faint">
        Long-form posts from users with a verified NIP-05 identity.
      </p>
      <ul className="mt-2 divide-y divide-border">
        {visible.map(({ event, article }) => (
          <NewsRow
            key={article.address}
            event={event}
            article={article}
            counts={counts.get(event.id)}
          />
        ))}
      </ul>
    </>
  )
}

function NewsRow({
  event,
  article,
  counts,
}: {
  event: NostrEvent
  article: ParsedLongForm
  counts?: NoteCounts
}): React.ReactNode {
  const profile = useProfile(event.pubkey)
  const name = profileDisplayName({ ...profile, pubkey: event.pubkey })
  const preview =
    article.summary !== undefined && article.summary.trim() !== ''
      ? article.summary
      : article.content.replace(/^#+\s*/gm, '').replace(/[*_`>]/g, '').slice(0, 200)

  return (
    <li>
      <Link href={`/e/${event.id}`} className="flex gap-4 py-4 transition-colors hover:bg-bg-elevated">
        <div className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs text-text-muted">
            <Avatar pubkey={event.pubkey} name={name} picture={profile?.picture} size="sm" />
            <span className="truncate">{name}</span>
          </span>
          <h3 className="mt-2 text-[15px] font-bold leading-snug text-text">{article.title}</h3>
          <p className="line-clamp-2 mt-1 text-sm leading-relaxed text-text-muted">{preview}</p>

          {/* The same actions the timeline and the Articles page. */}
          <div
            className="-ml-2 mt-2 max-w-[380px]"
            onClick={clickEvent => {
              clickEvent.preventDefault()
              clickEvent.stopPropagation()
            }}
          >
            <InteractionBar event={event} counts={counts} />
          </div>
        </div>
        {article.image !== undefined && article.image.trim() !== '' ? (
          <ArticleCover
            url={article.image}
            author={event.pubkey}
            icon={24}
            className="size-20 shrink-0 rounded-lg bg-bg-inset object-cover"
          />
        ) : null}
      </Link>
    </li>
  )
}

// ---------------------------------------------------------------------------.

function Empty({ children }: { children: React.ReactNode }): React.ReactNode {
  return <p className="px-1 py-10 text-center text-sm text-text-muted">{children}</p>
}
