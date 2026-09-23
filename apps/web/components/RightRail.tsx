'use client'

import { Link } from './AppLink'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AdvancedSearch } from './AdvancedSearch'

import { entityHref, hashtagHref, profileHref } from '../lib/links'
import { TOPICS_WINDOW_KEY, TRENDING_WINDOW_KEY, useWindowChoice } from '../lib/rail-windows'
import { useTopics } from '../lib/explore'
import { useInView } from '../lib/in-view'
import { manipulatedEngagement } from '../lib/abuse'
import { isExcludedFromTrending, isPromotable, isTagSpam, bodySignature } from '../lib/spam'
import { useTrending } from '../lib/trending'
import { WhoToFollow } from './WhoToFollow'
import { MENTION_LISTBOX_ID, MentionPicker } from './MentionPicker'
import { useSearchMentions } from '../lib/search-mentions'
import { sessionPubkey, useSession } from './SessionProvider'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { encodeNote, profileDisplayName, type Hex, type NostrEvent } from '@nostrich/nostr'

import { getCachedEvent, rememberEvent, rememberEvents } from '../lib/event-cache'
import { getPool } from '../lib/pool'
import { npubOf, relativeTime } from '../lib/format'
import { useProfile } from '../lib/profiles'
import { InteractionIcon } from './InteractionIcon'
import { Avatar } from './Avatar'
import { useNowSeconds } from './Clock'
import { RecentSearches } from './RecentSearches'
import { rememberSearch } from '../lib/recent-searches'
import { LatestArticles } from './LatestArticles'
import { TrendingRows } from './RailNoteRows'
import { resolveEntity } from '../lib/entity'

/** The sidebar beside the reading column: what is happening, and who to follow. */
export function RightRail(): React.ReactNode {
  const [query, setQuery] = useState('')
  /** `@` lists people here the same way it does in the composer. */
  const searchRef = useRef<HTMLInputElement>(null)
  const mentions = useSearchMentions()
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  // Shown while the field has focus and the reader has not typed anything yet.
  const [recentOpen, setRecentOpen] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  /* 24h by DEFAULT, not permanently. */
  const [globalHours, setGlobalHours] = useWindowChoice(TRENDING_WINDOW_KEY, RAIL_WINDOWS, 24)
  /* Its own window, independent of Trending notes: a reader may want the day's topics. */
  const [tagHours, setTagHours] = useWindowChoice(TOPICS_WINDOW_KEY, RAIL_WINDOWS, 24)
  const router = useRouter()
  const profilePubkey = useProfilePagePubkey()

  return (
    <div className="aside-column no-scrollbar w-full hidden md:block sticky top-[17px] h-dvh overflow-y-auto">
      <form
        className="search relative mb-3 mr-3"
        role="search"
        onSubmit={e => {
          e.preventDefault()
          const q = query.trim()
          if (q === '') return
          rememberSearch(q)
          setRecentOpen(false)
          router.push(`/explore?q=${encodeURIComponent(q)}`)
        }}
      >
        <label htmlFor="site-search" className="sr-only">
          Search
        </label>
        <input
          id="site-search"
          name="q"
          type="search"
          /** The browser's own form history is turned OFF here. */
          autoComplete="off"
          onFocus={() => setRecentOpen(true)}
          // A real delay, not zero: a click inside the panel has to land before the blur.
          onBlur={() => setTimeout(() => setRecentOpen(false), 120)}
          ref={searchRef}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            mentions.sync(e.currentTarget)
          }}
          // The caret moves without `onChange`.
          onKeyUp={e => mentions.sync(e.currentTarget)}
          onClick={e => mentions.sync(e.currentTarget)}
          aria-controls={mentions.query !== undefined ? MENTION_LISTBOX_ID : undefined}
          // No focus border.
          className="w-full rounded-lg border border-border bg-bg-inset py-2.5 pl-4 pr-11 text-text placeholder:text-text-faint focus:outline-none"
          placeholder="Search notes and people"
        />
        {/* `@` lists people, exactly as it does in the composer. */}
        {mentions.query !== undefined ? (
          <MentionPicker
            query={mentions.query}
            viewer={viewer}
            field={searchRef.current}
            onPick={pubkey => mentions.pick(pubkey)}
            onDismiss={mentions.dismiss}
          />
        ) : null}
        {/* Sliders, not a cog: the panel behind it adjusts THIS query rather than app. */}
        <button
          type="button"
          onClick={() => setAdvanced(true)}
          aria-label="Advanced search"
          title="Advanced search"
          className="absolute inset-y-0 right-1 my-auto flex size-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-elevated hover:text-text"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="16" cy="18" r="2" />
          </svg>
        </button>
        {/* Only while empty: once there are characters the reader is composing a new query. */}
        {recentOpen && query.trim() === '' ? (
          <RecentSearches
            onPick={term => {
              rememberSearch(term)
              router.push(`/explore?q=${encodeURIComponent(term)}`)
            }}
            onClose={() => setRecentOpen(false)}
          />
        ) : null}

      </form>

      {advanced ? <AdvancedSearch onClose={() => setAdvanced(false)} /> : null}

      {/* ORDER IS PER PAGE. */}
      {profilePubkey === undefined ? null : <LatestArticles pubkey={profilePubkey as never} />}
      {/* Under the articles, both scoped to the person whose page. */}

      {/* THE ORDER DEPENDS ON WHETHER THERE IS A PERSON TO LEAD. */}
      {profilePubkey === undefined ? (
        <>
          <TrendingPanel hours={globalHours} onHours={setGlobalHours} />
          <WhatsHappening hours={tagHours} onHours={setTagHours} />
        </>
      ) : (
        <>
          <WhatsHappening hours={tagHours} onHours={setTagHours} />
          <TrendingPanel hours={globalHours} onHours={setGlobalHours} />
        </>
      )}

      {/* AFTER the two charts, and the order is the argument: what is happening. */}
      <WhoToFollow />

      <footer className="mr-3 space-y-2 pb-8 text-xs leading-relaxed text-text-faint">
        <p>© 2026 Nostrich. All rights reserved.</p>
        <p>
          Nostrich is a free and open-source Nostr client. Notes, profiles and media live on Nostr
          relays and are not hosted by Nostrich.{' '}
          {/* The one link in the footer, so it has to look like one. */}
          <Link
            href="/donate"
            className="font-semibold text-text underline underline-offset-2 hover:text-text-muted"
          >
            Donate here
          </Link>{' '}
          to support its development.
        </p>
      </footer>
    </div>
  )
}

/** The most-engaged notes on the network in the last 24 hours. */
function GlobalTrending({ hours }: { hours: number }): React.ReactNode {
  const { entries, loading, error } = useTrending(hours, true)
  /** Minute resolution: the age boundary must move on its own, and this gates a whole. */
  const minute = Math.floor(useNowSeconds() / 60)
    /* The shorter-window exclusion is deliberately absent. */

  /** One note per author, whatever the window. */
  const ids = useMemo(() => entries.slice(0, SCAN).map(entry => entry.id), [entries])
  const events = useEventsByIds(ids)
  /** The same list, ignoring which window claims a note. */
  const fallbackRows = (): NostrEvent[] => {
    const byId = new Map(events.map(event => [event.id, event]))
    const seen = new Set<string>()
    const out: NostrEvent[] = []
    const now = Math.floor(Date.now() / 1000)
    for (const entry of entries) {
      const event = byId.get(entry.id)
      if (event === undefined || seen.has(event.pubkey)) continue
      if (isTagSpam(event) || !isPromotable(event)) continue
      if (isExcludedFromTrending(event.pubkey)) continue
      if (event.created_at < now - hours * 3600) continue
      seen.add(event.pubkey)
      out.push(event)
      if (out.length >= SHOWN) break
    }
    return out
  }

  const cachedRows = useMemo((): NostrEvent[] | undefined => undefined, [])

  const rows = useMemo(() => {
    /* THE LAST GOOD ANSWER COUNTS TOO, and this is what makes the panel stable. */
    const byId = new Map((cachedRows ?? []).map(event => [event.id, event]))
    for (const event of events) byId.set(event.id, event)
    const seen = new Set<string>()
    const seenBody = new Set<string>()
    const out: NostrEvent[] = []
    /* Live, not frozen when this memo last ran. */
    const now = minute * 60
    // Placement in THIS window, so a shorter one only takes the note if it ranks it higher.
    let rank = -1
    for (const entry of entries) {
      rank += 1
      const event = byId.get(entry.id)
      if (event === undefined || seen.has(event.pubkey)) continue
      // The index ranks by engagement and has no opinion about who is worth reading.
      if (isTagSpam(event)) continue
      // Never promoted here either.
      if (!isPromotable(event)) continue
      /* Kept off the charts and off nothing else. */
      if (isExcludedFromTrending(event.pubkey)) continue
      /* Bought engagement, dropped. */
      if (
        manipulatedEngagement({
          replies: entry.replies,
          likes: entry.reactions,
          reposts: entry.reposts,
          zapSats: entry.zapSats,
        }) !== undefined
      ) {
        continue
      }
      // Posted inside the window as well as engaged with inside.
      if (event.created_at < now - hours * 3600) continue
      // A shorter window ranks it higher, so it belongs there and not here.
      /* NOT CLAIMED AWAY HERE. */
      /* ONE COPY OF A TEMPLATE, however many accounts posted. */
      const body = bodySignature(event.content)
      if (body !== undefined && seenBody.has(body)) continue
      if (body !== undefined) seenBody.add(body)
      seen.add(event.pubkey)
      out.push(event)
      if (out.length >= SHOWN) break
    }
    return out
  }, [entries, events, cachedRows, hours, minute])

  /** THE ROWS THIS PANEL LAST SHOWED, painted while the two fetches behind it run again. */

  /** THE PANEL IS LOADING UNTIL IT HAS ROWS, not until the index arrives. */
  const indexReady = entries.length > 0
  const [bodiesTimedOut, setBodiesTimedOut] = useState(false)
  useEffect(() => {
    if (!indexReady || rows.length > 0) {
      setBodiesTimedOut(false)
      return
    }
    const timer = setTimeout(() => setBodiesTimedOut(true), 15_000)
    return () => clearTimeout(timer)
  }, [indexReady, rows.length, hours])

  // Anything already on disk beats a skeleton, and beats it immediately.
  if (rows.length === 0 && cachedRows !== undefined) {
    return <TrendingRows rows={cachedRows} />
  }

  if (loading || (indexReady && rows.length === 0 && !bodiesTimedOut)) {
    return (
      /* SHOWN rows, not a viewport's worth. */
      <ul className="mt-3 space-y-3 px-5" aria-hidden="true">
        {Array.from({ length: SHOWN }, (_, row) => (
          <li key={row} className="flex gap-2.5">
            <div className="size-8 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
            <div className="flex-1 space-y-1.5 pt-0.5">
              <div className="h-3 w-24 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
              <div className="h-3 w-full animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
            </div>
          </li>
        ))}
      </ul>
    )
  }

  if (error !== null) {
    return (
      <p className="mt-3 px-5 text-sm text-text-faint">
        The trending index is unreachable right now.
      </p>
    )
  }

  if (rows.length === 0) {
    /* "NOTHING TRENDING" MEANS THE INDEX HAD NOTHING, not that our own rules emptied. */
    const unclaimed = fallbackRows()
    if (unclaimed.length > 0) {
      return <TrendingRows rows={unclaimed} />
    }
    // The window, not a hardcoded 24 hours: this panel has had a picker.
    return (
      <p className="mt-3 px-5 text-sm text-text-faint">
        Nothing trending in the last {hours === 1 ? 'hour' : `${hours} hours`}.
      </p>
    )
  }

  return (
    // NO inner scroller.

    // This used to be a 46rem box with its own hidden scrollbar, back when it held fifty.

    // A rank number is left off deliberately: an avatar says whose note.
    <TrendingRows rows={rows} />
  )
}

/** The list itself, so the fallback above draws exactly what the normal path draws. */

/** Ten, in two columns. */
const TAG_COUNT = 10

/** Hashtags, from the same wide sample the Topics tab reads. */
function TrendList({ hours }: { hours: number }): React.ReactNode {
  /** Deferred until the panel is near the viewport. */
  const [ref, inView] = useInView()
  const { topics: tags, loading } = useTopics(inView, TAG_COUNT, hours)

  // Also the not-yet-in-view state: the skeleton is what gives the observer a node.
  if (!inView || (loading && tags.length === 0)) {
    return (
      /* TAG_COUNT boxes in the same two-column grid, so nothing moves when the data lands. */
      <ul ref={ref as never} className="mt-3 grid grid-cols-2 gap-2 px-5" aria-hidden="true">
        {Array.from({ length: TAG_COUNT }, (_, row) => (
          <li key={row} className="space-y-1.5 rounded-lg bg-bg-inset px-3 py-2.5">
            <div className="h-3.5 w-20 animate-pulse rounded-sm bg-border motion-reduce:animate-none" />
            <div className="h-3 w-12 animate-pulse rounded-sm bg-border motion-reduce:animate-none" />
          </li>
        ))}
      </ul>
    )
  }

  if (tags.length === 0) {
    return (
      <p ref={ref as never} className="px-5 text-sm text-text-faint">
        No hashtags are trending right now.
      </p>
    )
  }

  /** The most-discussed tag on screen, which the bars are drawn. */
  // Notes, matching both the number on the row and the order of the rows.
  const mostNotes = Math.max(...tags.map(topic => topic.notes), 1)

  return (
    <ul ref={ref as never} className="mt-3 grid grid-cols-2 gap-2 px-5">
      {tags.map(({ tag, notes, atLeast, score }, index) => (
        <li key={tag}>
          <Link
            href={hashtagHref(tag)}
            /** Notes in words, people as the bar. */
            /* The exact count lives here, `+` included when we stopped counting. */
            title={`#${tag}, ${score.toLocaleString()} ${score === 1 ? 'person' : 'people'}, ${notes.toLocaleString()}${atLeast ? '+' : ''} ${notes === 1 && !atLeast ? 'note' : 'notes'}`}
            className="flex items-center gap-2.5 rounded-lg bg-bg-inset px-3 py-2.5 transition-colors hover:bg-border"
          >
            {/* Ranked, like the Topics tab. */}
            <span className="w-4 shrink-0 text-sm font-semibold text-text-faint">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-text">#{tag}</span>
              <span className="block truncate text-xs text-text-faint">
                {noteLabel(notes)} {notes === 1 ? 'note' : 'notes'}
              </span>
              {/* How many PEOPLE, relative to the busiest tag here. */}
              <span
                aria-hidden="true"
                className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-border"
              >
                <span
                  className="block h-full rounded-full bg-text-faint/50"
                  style={{ width: `${Math.max(6, Math.round((notes / mostNotes) * 100))}%` }}
                />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** One batched fetch for the whole sample, cached. */
function useEventsByIds(ids: readonly string[]): NostrEvent[] {
  const key = ids.join(',')
  const query = useQuery({
    queryKey: ['events', key],
    queryFn: async () => {
      if (ids.length === 0) return []
      const events = await getPool().query([{ ids: [...ids] }], undefined, 8_000)
      rememberEvents(events)
      return events
    },
    enabled: ids.length > 0,
    staleTime: 300_000,
  })
  return query.data ?? EMPTY_EVENTS
}

const EMPTY_EVENTS: NostrEvent[] = []

/** The windows the rail's own picker offers, for the one-note-one-window rule. */
const RAIL_WINDOWS = [1, 4, 24]

/** The network's trending notes. */
function TrendingPanel({
  hours,
  onHours,
}: {
  hours: number
  onHours: (hours: number) => void
}): React.ReactNode {
  return (
    <section
      aria-labelledby="trending-heading"
      className="mb-3 mr-3 rounded-lg border border-border bg-bg-elevated py-5"
    >
      <div className="flex items-baseline justify-between gap-2 px-5">
        <h2 id="trending-heading" className="text-xl font-bold text-text">
          Trending notes
        </h2>
        {/* The window is a property of the question, so it sits with the heading rather. */}
        <WindowSelect label="Trending window" value={hours} onChange={onHours} />
      </div>
      <GlobalTrending hours={hours} />
    </section>
  )
}

/** How a note count is written under a hashtag. */
function noteLabel(notes: number): string {
  if (notes < 500) return notes.toLocaleString()
  return `${(Math.floor(notes / 100) * 100).toLocaleString()}+`
}

/** How old a stored row list may be and still be shown while a fresh one is fetched. */
const PANEL_ROWS_MAX_MS = 60 * 60_000

/** Ranked entries pulled per window, before one-per-author narrows them. */
const SCAN = 60
/** Rows the panel keeps after deduplicating. */
const SHOWN = 10

/** Single-event fetch, cached by react-query so five rows do not become five REQs. */
/** The network's busiest hashtags in a window. */
function WhatsHappening({
  hours,
  onHours,
}: {
  hours: number
  onHours: (hours: number) => void
}): React.ReactNode {
  return (
    <section
      aria-labelledby="trends-heading"
      className="whats mb-3 mr-3 rounded-lg border border-border bg-bg-elevated py-5"
    >
      <div className="flex items-baseline justify-between gap-2 px-5">
        <h2 id="trends-heading" className="text-xl font-bold text-text">
          What&apos;s happening
        </h2>
        <WindowSelect label="Trending tags window" value={hours} onChange={onHours} />
      </div>
      {/* Counted from the tags on the globally trending notes. */}
      <TrendList hours={hours} />
    </section>
  )
}

/** The pubkey of the profile being viewed, or undefined anywhere else. */
/** WHOSE PAGE. */
function useProfilePagePubkey(): string | undefined {
  const pathname = usePathname()
  const noteId = pathname.startsWith('/e/') ? resolveEntity(pathname.slice(3), 'event')?.hex : undefined
  const noteAuthor = useCachedEventAuthor(noteId)
  if (pathname.startsWith('/p/')) return resolveEntity(pathname.slice(3), 'profile')?.hex
  return noteAuthor
}

/** The author of the note being read, once it has arrived. */
function useCachedEventAuthor(id: string | undefined): string | undefined {
  const [author, setAuthor] = useState<string | undefined>(() =>
    id === undefined ? undefined : getCachedEvent(id as Hex)?.pubkey,
  )
  useEffect(() => {
    if (id === undefined) {
      setAuthor(undefined)
      return
    }
    const found = getCachedEvent(id as Hex)?.pubkey
    if (found !== undefined) {
      setAuthor(found)
      return
    }
    setAuthor(undefined)
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      const hit = getCachedEvent(id as Hex)?.pubkey
      // Twenty tries at 300ms.
      if (hit !== undefined || tries >= 20) {
        clearInterval(timer)
        if (hit !== undefined) setAuthor(hit)
      }
    }, 300)
    return () => clearInterval(timer)
  }, [id])
  return author
}

/** The 24h / 4h / 1h window picker. */
function WindowSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (hours: number) => void
}): React.ReactNode {
  return (
    <span className="relative shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="cursor-pointer appearance-none rounded-lg border border-border bg-bg py-1 pl-2.5 pr-7 text-xs text-text-muted focus:border-accent focus:outline-none"
      >
        <option value={24}>24h</option>
        <option value={4}>4h</option>
        <option value={1}>1h</option>
      </select>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  )
}
