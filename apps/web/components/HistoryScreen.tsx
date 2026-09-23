'use client'

import { Link } from './AppLink'
import { useMemo, useState } from 'react'
import {
  bookmarkKey,
  parseLongForm,
  profileDisplayName,
  type Bookmark,
  type NostrEvent,
} from '@nostrich/nostr'

import { useBookmarks, useBookmarkedEvents } from '../lib/bookmarks'
import { useTabParam } from '../lib/tab-param'
import { useInteractions } from '../lib/interactions'
import { countedId } from '../lib/reposts'
import { absoluteDate } from '../lib/format'
import { useLikes } from '../lib/likes'
import { hashtagHref } from '../lib/links'
import { useProfile } from '../lib/profiles'
import { PAGE, PAGE_TITLE, SCALED_BODY, TAB_ACTIVE, TAB_CELL, TAB_IDLE, TAB_LABEL, TAB_STRIP, TAB_STRIP_BLEED, TAB_STRIP_ROW, TAB_UNDERLINE } from '../lib/styles'
import { ContentLink } from './ContentLink'
import { Avatar } from './Avatar'
import type { NoteCounts } from '@nostrich/app'
import { NoteCard } from './NoteCard'
import { sessionPubkey, useSession } from './SessionProvider'

/** What the reader has kept: things they saved, and things they liked. */

type TabId = 'bookmarks' | 'likes'

const TABS: { id: TabId; label: string }[] = [
  { id: 'bookmarks', label: 'Bookmarks' },
  { id: 'likes', label: 'Likes' },
]

type FilterId = 'all' | 'notes' | 'articles' | 'tags' | 'links'

const FILTERS: { id: FilterId; label: string; type?: Bookmark['type'] }[] = [
  { id: 'all', label: 'All' },
  { id: 'notes', label: 'Notes', type: 'e' },
  { id: 'articles', label: 'Articles', type: 'a' },
  { id: 'tags', label: 'Tags', type: 't' },
  { id: 'links', label: 'Links', type: 'r' },
]

export function HistoryScreen(): React.ReactNode {
  const { session } = useSession()
  const signedIn = sessionPubkey(session) !== undefined
  const [tab, setTab] = useTabParam<TabId>(['bookmarks', 'likes'], 'bookmarks')

  const bookmarks = useBookmarks()
  const likes = useLikes()

  const items = tab === 'bookmarks' ? bookmarks.items : likes.items
  const loading = tab === 'bookmarks' ? bookmarks.loading : likes.loading
  const { events, loading: resolving } = useBookmarkedEvents(items)

  // The third surface that rendered note cards without ever asking what happened to them.
  const noteIds = useMemo(() => [...events.values()].map(countedId), [events])
  const { counts } = useInteractions(noteIds)

  const [filter, setFilter] = useState<FilterId>('all')
  const present = useMemo(() => new Set(items.map(item => item.type)), [items])
  const shown = useMemo(() => {
    const wanted = FILTERS.find(entry => entry.id === filter)?.type
    return wanted === undefined ? items : items.filter(item => item.type === wanted)
  }, [items, filter])

  if (!signedIn) {
    return (
      <div className={PAGE}>
        <h1 className={PAGE_TITLE}>History</h1>
        <p className={`mt-4 ${SCALED_BODY} text-text-muted`}>
          <Link href="/login" className="underline decoration-border-strong underline-offset-2">
            Sign in
          </Link>{' '}
          to save notes. Bookmarks and likes are published to your relays, so they follow you
          to any Nostr client.
        </p>
      </div>
    )
  }

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>History</h1>

      <div className={`mt-4 ${TAB_STRIP} ${TAB_STRIP_BLEED}`}>
        <div role="tablist" aria-label="History" className={TAB_STRIP_ROW}>
          {TABS.map(item => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={tab === item.id}
              onClick={() => {
                setTab(item.id)
                // The filter row is built from what the OTHER tab holds.
                setFilter('all')
              }}
              className={TAB_CELL}
            >
              <span className={TAB_LABEL}>
                <span className={tab === item.id ? TAB_ACTIVE : TAB_IDLE}>
                  {item.label}
                </span>
                {tab === item.id ? (
                  <span aria-hidden="true" className={TAB_UNDERLINE} />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Only when it is bad news. */}
      {tab === 'bookmarks' && !bookmarks.isPrivate ? (
        <p className="mt-4 text-sm text-text-muted">
          Your signer cannot encrypt, so this list is public on your relays.
        </p>
      ) : null}

      {tab === 'bookmarks' && bookmarks.error === 'publish' ? (
        <p className="mt-4 rounded-lg border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-text">
          That change could not be saved. No relay accepted the list, so it still looks the way
          it did before.
        </p>
      ) : null}

      {present.size > 1 ? (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.filter(entry => entry.type === undefined || present.has(entry.type)).map(entry => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
              className={`shrink-0 cursor-pointer rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                filter === entry.id
                  ? 'border-text bg-text text-bg'
                  : 'border-border-strong bg-bg-elevated text-text-muted hover:bg-bg-inset'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        /* Twelve rows, matching every other full-page list. */
        <ul className="mt-2" aria-hidden="true">
          {['85%', '62%', '78%', '55%', '90%', '68%', '74%', '58%', '83%', '65%', '88%', '70%'].map((width, row) => (
            <li key={row} className="flex gap-3 border-b border-border py-5">
              <div className="size-10 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 w-40 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
                <div
                  className="h-3 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none"
                  style={{ width }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <p className={`px-1 py-10 text-center ${SCALED_BODY} text-text-muted`}>
          {tab === 'bookmarks'
            ? 'Nothing bookmarked yet. Notes you bookmark will appear here.'
            : 'Nothing liked yet. Notes you like will appear here.'}
        </p>
      ) : (
        <ul className="mt-1">
          {shown.map(item => (
            <Row
              key={bookmarkKey(item)}
              item={item}
              event={events.get(bookmarkKey(item))}
              counts={counts}
              resolving={resolving}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({
  item,
  event,
  counts,
  resolving,
}: {
  item: Bookmark
  event: NostrEvent | undefined
  counts: Map<string, NoteCounts>
  resolving: boolean
}): React.ReactNode {
  if (item.type === 't') {
    return (
      <li className="border-b border-border">
        <Link
          href={hashtagHref(item.value)}
          className="flex items-center gap-3 py-4 transition-colors hover:bg-bg-elevated"
        >
          <span className="material-symbols-outlined text-nav-icon text-[22px]!" aria-hidden="true">
            tag
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold text-text">#{item.value}</span>
        </Link>
      </li>
    )
  }

  if (item.type === 'r') {
    return (
      <li className="border-b border-border">
        {/* A saved link is by definition untrusted. */}
        <ContentLink
          href={item.value}
          className="flex items-center gap-3 py-4 transition-colors hover:bg-bg-elevated"
        >
          <span className="material-symbols-outlined text-nav-icon text-[22px]!" aria-hidden="true">
            link
          </span>
          <span className="min-w-0 flex-1 truncate text-text">{item.value}</span>
        </ContentLink>
      </li>
    )
  }

  if (event === undefined) {
    // A skeleton while it resolves, not the word "Loading".
    return (
      <li className="border-b border-border py-5">
        {resolving ? (
          <div className="flex gap-3" aria-hidden="true">
            <div className="size-10 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-40 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
              <div className="h-3 w-3/4 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            Saved, but none of your relays have it right now.
          </p>
        )}
      </li>
    )
  }

  if (item.type === 'a') return <ArticleRow event={event} />

  return (
    <li className="border-b border-border">
      <NoteCard event={event} counts={counts.get(countedId(event))} />
    </li>
  )
}

function ArticleRow({ event }: { event: NostrEvent }): React.ReactNode {
  const article = parseLongForm(event)
  const profile = useProfile(event.pubkey)
  const name = profileDisplayName({ ...profile, pubkey: event.pubkey })

  return (
    <li className="border-b border-border transition-colors hover:bg-bg-elevated">
      <Link href={`/e/${event.id}`} className="block py-5">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Avatar pubkey={event.pubkey} name={name} picture={profile?.picture} size="sm" />
          <span className="truncate">{name}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{absoluteDate(article.publishedAt ?? event.created_at)}</span>
        </div>
        <h2 className="mt-2 text-lg font-bold leading-snug text-text">{article.title}</h2>
        {article.summary !== undefined && article.summary.trim() !== '' ? (
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-muted">{article.summary}</p>
        ) : null}
      </Link>
    </li>
  )
}
