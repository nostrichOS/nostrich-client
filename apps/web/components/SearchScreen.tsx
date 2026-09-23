'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AdvancedSearch, fromSearchParams, toSearchParams, type SearchQuery } from './AdvancedSearch'
import { useInteractions } from '../lib/interactions'
import { RecentSearches } from './RecentSearches'
import { rememberSearch } from '../lib/recent-searches'
import { capPerAuthor } from '../lib/quality'
import { useProfileSearch } from '../lib/profile-search'
import { useProfileGate } from '../lib/quality'
import { useVerifiedPubkeys } from '../lib/verified'
import { useSearch, terms, type SearchInput } from '../lib/search'
import { SEARCH_SORTS, SEARCH_SORT_LABELS, sortSearch, type SearchSort } from '../lib/search-sort'
import { useTabParam } from '../lib/tab-param'
import { useLastActive } from '../lib/last-active'
import { PAGE, PAGE_TITLE, TAB_ACTIVE, TAB_CELL, TAB_IDLE, TAB_LABEL, TAB_STRIP, TAB_STRIP_BLEED, TAB_STRIP_ROW, TAB_UNDERLINE } from '../lib/styles'
import { ExploreTabs } from './ExploreTabs'
import { NoteCard } from './NoteCard'
import { sessionPubkey, useSession } from './SessionProvider'
import { MENTION_LISTBOX_ID, MentionPicker } from './MentionPicker'
import { useSearchMentions } from '../lib/search-mentions'
import { UserResult } from './UserResult'

/** Search results. */
/** Rows revealed per step. Matches the timeline's own page size. */
const PAGE_SIZE = 30
/** Rows this screen will draw at all. */
const RENDER_CAP = 600

/** Below this many results, a short list reads as "that is everybody" and the degraded. */
const THIN_RESULTS = 5

/** How the Users tab can be ordered. */
const PEOPLE_SORTS = ['match', 'active'] as const
type PeopleSort = (typeof PEOPLE_SORTS)[number]

const PEOPLE_SORT_LABELS: Record<PeopleSort, string> = {
  /* `Relevance`, the word the Notes tab uses for the identical idea. */
  match: 'Relevance',
  active: 'Recently active',
}

export function SearchScreen(): React.ReactNode {
  const params = useSearchParams()
  const router = useRouter()
  const { session } = useSession()
  const viewer = sessionPubkey(session)

  const include = params.get('q') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const zappedBy = params.get('zapby') ?? ''
  const since = (params.get('since') ?? '') as SearchInput['since']

  const input = useMemo<SearchInput>(
    () => ({ include, from, to, zappedBy, since }),
    [include, from, to, zappedBy, since],
  )

  const hasQuery =
    include.trim() !== '' ||
    from.trim() !== '' ||
    to.trim() !== '' ||
    zappedBy.trim() !== '' ||
    since !== ''
  const {
    notes: rawNotes,
    loading,
    loadingMore,
    exhausted,
    error,
    loadMore,
  } = useSearch(input, hasQuery)

  /** Which tab, from the URL like everything else on this screen. */
  /* `kind=profiles` selects the Users tab, which is the only thing it ever meant. */
  /* Counted over everything held rather than over the rendered window: the Top sort. */
  const noteIds = useMemo(() => rawNotes.map(note => note.id), [rawNotes])
  const { counts } = useInteractions(noteIds)

  const tab: 'notes' | 'users' =
    params.get('tab') === 'users' || params.get('kind') === 'profiles' ? 'users' : 'notes'
  /** Verified only, ON by default. */
  const [verifiedParam, setVerifiedParam] = useTabParam<'1' | '0'>(['1', '0'], '1', 'verified')
  /** How the people are ordered. */
  const [peopleSort, setPeopleSort] = useTabParam<PeopleSort>(
    [...PEOPLE_SORTS],
    'match',
    'people',
  )
  const verifiedOnly = verifiedParam === '1'

  const people = useProfileSearch(include, hasQuery)
  const { verified: verifiedPeople } = useVerifiedPubkeys(
    people.profiles.map(hit => ({
      pubkey: hit.pubkey,
      ...(hit.nip05 === undefined ? {} : { nip05: hit.nip05 }),
    })),
    verifiedOnly,
  )
  const shownPeople = useMemo(
    () =>
      verifiedOnly
        ? people.profiles.filter(hit => hit.exact === true || verifiedPeople.has(hit.pubkey))
        : people.profiles,
    [people.profiles, verifiedOnly, verifiedPeople],
  )
  /* ASKED FOR ONLY WHEN IT IS BEING SORTED. */
  const activeKeys = useMemo(() => shownPeople.map(hit => hit.pubkey), [shownPeople])
  const lastActive = useLastActive(activeKeys, peopleSort !== 'match')

  /** Undated accounts sort LAST. */
  const orderedPeople = useMemo(() => {
    if (peopleSort === 'match') return shownPeople
    return [...shownPeople].sort((a, b) => {
      const left = lastActive.get(a.pubkey)
      const right = lastActive.get(b.pubkey)
      if (left === undefined && right === undefined) return 0
      if (left === undefined) return 1
      if (right === undefined) return -1
      return right - left
    })
  }, [shownPeople, peopleSort, lastActive])

  /** Sort, from the URL like everything else here. */
  const [sort, setSort] = useTabParam<SearchSort>([...SEARCH_SORTS], 'recent', 'sort')

  /** ORDERED, THEN CAPPED, THEN WINDOWED. */
  const want = useMemo(() => terms(include), [include])
  // The same gate the Articles page applies, for the same reason.
  const gate = useProfileGate(rawNotes, { enabled: verifiedOnly, requireNip05: true })
  const gated = useMemo(
    () => (verifiedOnly ? rawNotes.filter(event => gate.accepts(event)) : rawNotes),
    [rawNotes, verifiedOnly, gate],
  )
  const sorted = useMemo(
    () => sortSearch(gated, sort, want, counts),
    [gated, sort, want, counts],
  )
  const notes = useMemo(() => capPerAuthor(sorted, 3), [sorted])

  const setTab = (next: 'notes' | 'users'): void => {
    const qs = new URLSearchParams(params.toString())
    if (next === 'notes') qs.delete('tab')
    else qs.set('tab', 'users')
    // replace, not push: flicking between two views of one search is not two destinations.
    router.replace(qs.toString() === '' ? '/explore' : `/explore?${qs.toString()}`, { scroll: false })
  }

  // Seeded from the URL and re-seeded whenever it changes, so a shared link, the back.
  const [term, setTerm] = useState(include)
  useEffect(() => {
    setTerm(include)
  }, [include])
  const [advanced, setAdvanced] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  /** `@` lists people here the same way it does in the composer. */
  const searchRef = useRef<HTMLInputElement>(null)
  const mentions = useSearchMentions()

  /** How many of the results are on screen. */
  const [visible, setVisible] = useState(PAGE_SIZE)
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [include, from, to, zappedBy, since, sort])

  const shown = useMemo(() => notes.slice(0, visible), [notes, visible])

  // Refs, so the observer is created once rather than on every arriving page.
  const heldRef = useRef(0)
  heldRef.current = notes.length
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  const sentinelRef = useRef<HTMLDivElement>(null)
  const paginates = tab === 'notes' && hasQuery
  useEffect(() => {
    const node = sentinelRef.current
    if (!paginates || node === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (entry === undefined || !entry.isIntersecting) return
        setVisible(current => {
          if (heldRef.current > current) return Math.min(current + PAGE_SIZE, RENDER_CAP)
          // Everything held is already on screen, so the next page has to come off the wire.
          loadMoreRef.current()
          return current
        })
      },
      { rootMargin: '800px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [paginates])

  const runSearch = (next: SearchQuery): void => {
    const qs = toSearchParams(next)
    router.push(qs === '' ? '/explore' : `/explore?${qs}`)
  }

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>
        {include.trim() !== '' ? `“${include.trim()}”` : 'Explore'}
      </h1>

      {/* A search box, and nothing else. */}
      <form
        role="search"
        className="relative mt-4 flex gap-2"
        onSubmit={e => {
          e.preventDefault()
          // Only the term is replaced.
          rememberSearch(term)
          setRecentOpen(false)
          runSearch({ ...fromSearchParams(params), include: term })
        }}
      >
        <label htmlFor="explore-q" className="sr-only">
          Search notes and people
        </label>
        <input
          id="explore-q"
          name="q"
          type="search"
          /** The browser's own form history is turned OFF here. */
          autoComplete="off"
          ref={searchRef}
          value={term}
          onChange={e => {
            setTerm(e.target.value)
            mentions.sync(e.currentTarget)
          }}
          // The caret moves without `onChange`.
          onKeyUp={e => mentions.sync(e.currentTarget)}
          onClick={e => mentions.sync(e.currentTarget)}
          aria-controls={mentions.query !== undefined ? MENTION_LISTBOX_ID : undefined}
          onFocus={() => setRecentOpen(true)}
          // A real delay, not zero: a click inside the panel has to land before blur unmounts.
          onBlur={() => setTimeout(() => setRecentOpen(false), 120)}
          placeholder="Search notes and people"
          /* NO focus border. */
          className="w-full rounded-lg border border-border bg-bg-inset py-2.5 pl-4 pr-4 text-text placeholder:text-text-faint focus:outline-none"
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
        {/* Only while empty: once there are characters the reader is composing a new query. */}
        {recentOpen && term.trim() === '' && mentions.query === undefined ? (
          <RecentSearches
            onPick={picked => {
              rememberSearch(picked)
              setTerm(picked)
              runSearch({ ...fromSearchParams(params), include: picked })
            }}
            onClose={() => setRecentOpen(false)}
          />
        ) : null}

        {/* Sliders, not a cog: the panel behind it adjusts THIS query rather than app. */}
        <button
          type="button"
          onClick={() => setAdvanced(true)}
          aria-label="Advanced search"
          title="Advanced search"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
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
      </form>

      {advanced ? <AdvancedSearch onClose={() => setAdvanced(false)} /> : null}

      {error !== null ? (
        <p role="alert" className="mt-4 text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      {/* Results replace Explore rather than appearing. */}
      {hasQuery ? (
        <>
          <div className={`mt-4 ${TAB_STRIP} ${TAB_STRIP_BLEED}`}>
            <div role="tablist" aria-label="Search results" className={TAB_STRIP_ROW}>
              {(
                [
                  ['notes', 'Notes', notes.length],
                  ['users', 'Users', shownPeople.length],
                ] as ['notes' | 'users', string, number][]
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={TAB_CELL}
                >
                  <span className={TAB_LABEL}>
                    <span className={tab === id ? TAB_ACTIVE : TAB_IDLE}>
                      {label}
                      {count > 0 ? ` (${count})` : ''}
                    </span>
                    {tab === id ? (
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

          {tab === 'users' ? (
            <div className="-mx-4 sm:-mx-5">
              {/* THE NOTES TOOLBAR, exactly: count on the left, then Verified only, then the sort. */}
              <div className="mt-3 flex items-center justify-between gap-3 px-5">
                <p className="text-sm text-text-muted">
                  {people.loading
                    ? 'Searching people…'
                    : `${orderedPeople.length} ${orderedPeople.length === 1 ? 'user' : 'users'}`}
                </p>
                <span className="flex items-center gap-3">
                  <VerifiedToggle
                    on={verifiedOnly}
                    onChange={next => setVerifiedParam(next ? '1' : '0')}
                  />
                  <SortSelect
                    value={peopleSort}
                    onChange={setPeopleSort}
                    options={PEOPLE_SORTS}
                    labels={PEOPLE_SORT_LABELS}
                  />
                </span>
              </div>
              {people.loading && shownPeople.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-text-muted">Searching people…</p>
              ) : shownPeople.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-text-muted">
                  {/* Three different nothings, and they are not interchangeable. */}
                  {people.degraded
                    ? 'No search relay answered, so only accounts already known to this browser were searched. Try again in a moment.'
                    : verifiedOnly
                      ? 'Nobody verified matched that name. Turn off Verified only to include unverified accounts.'
                      : 'Nobody matched that name.'}
                </p>
              ) : (
                <>
                  {/* ONLY WHEN IT COULD MISLEAD, which is a short list. */}
                  {people.degraded && shownPeople.length < THIN_RESULTS ? (
                    <p className="px-5 pt-3 text-xs text-text-faint">
                      No search relay answered. These are accounts this browser already knew about.
                    </p>
                  ) : null}
                  <ul className="mt-1">
                    {orderedPeople.map(hit => (
                      <UserResult key={hit.pubkey} hit={hit} />
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <>
              {/* The count and the sort share a line, the way the rail's panels put their window. */}
              <div className="mt-3 flex items-center justify-between gap-3 px-1">
                <p className="text-sm text-text-muted">
                  {loading
                    ? 'Searching relays…'
                    : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
                </p>
                <span className="flex items-center gap-3">
                  <VerifiedToggle
                    on={verifiedOnly}
                    onChange={next => setVerifiedParam(next ? '1' : '0')}
                  />
                  <SortSelect value={sort} onChange={setSort} options={SEARCH_SORTS} labels={SEARCH_SORT_LABELS} />
                </span>
              </div>

              <div className="-mx-4 mt-2 sm:-mx-5">
                {shown.map(event => (
                  <NoteCard key={event.id} event={event} counts={counts.get(event.id)} />
                ))}
              </div>

              {!loading && notes.length === 0 && error === null ? (
                <p className="mt-6 px-1 text-sm text-text-muted">
                  No notes matched. Text search on Nostr is only answered by the few relays
                  that implement it, so an uncommon term can return nothing here even though it
                  exists on the network, people are found through an index instead, which is
                  why the Users tab may have results when this one does not.
                </p>
              ) : null}

              {paginates ? (
                <>
                  <div ref={sentinelRef} aria-hidden="true" className="h-px" />

                  {/* Three different endings, because they mean different things to the reader: more. */}
                  {shown.length >= RENDER_CAP ? (
                    <p className="pb-6 text-center text-xs text-text-faint">
                      Showing the first {RENDER_CAP} results. Narrow the search to see further.
                    </p>
                  ) : loadingMore ? (
                    <p className="pb-6 pt-2 text-center text-xs text-text-faint">
                      Searching further back…
                    </p>
                  ) : exhausted && notes.length > 0 ? (
                    <p className="pb-6 pt-2 text-center text-xs text-text-faint">
                      That is everything the search relays have for this query.
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </>
      ) : (
        <ExploreTabs />
      )}
    </div>
  )
}

/** Sort, as the platform's own picker. */
/** ONE sort control, for both tabs. */
function SortSelect<T extends string>({
  value,
  onChange,
  options,
  labels,
}: {
  value: T
  onChange: (next: T) => void
  options: readonly T[]
  labels: Record<T, string>
}): React.ReactNode {
  return (
    <span className="relative shrink-0">
      <select
        aria-label="Sort results"
        value={value}
        onChange={event => onChange(event.target.value as T)}
        className="cursor-pointer appearance-none rounded-lg border border-border bg-bg py-1 pl-2.5 pr-7 text-xs text-text-muted focus:outline-none"
      >
        {options.map(option => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
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

/** Verified only. */
function VerifiedToggle({
  on,
  onChange,
}: {
  on: boolean
  onChange: (next: boolean) => void
}): React.ReactNode {
  return (
    <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-text-muted">
      <input
        type="checkbox"
        checked={on}
        onChange={event => onChange(event.target.checked)}
        className="size-3.5 cursor-pointer accent-text"
      />
      Verified only
    </label>
  )
}
