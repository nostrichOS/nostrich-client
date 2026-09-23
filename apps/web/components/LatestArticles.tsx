'use client'

import { Link } from './AppLink'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isPrivateUrl, profileDisplayName, type Hex, type NostrEvent } from '@nostrich/nostr'

import { npubOf, relativeTime } from '../lib/format'
import { ArticleCover } from './ArticleCover'
import { noteHref } from '../lib/links'
import { getPool } from '../lib/pool'
import { useProfile } from '../lib/profiles'
import { BUTTON_QUIET } from '../lib/styles'
import { useNowSeconds } from './Clock'

/** This account's most recent long-form articles. */

/** Three. The rail is a pointer to the work, not a table of contents. */
const SHOWN = 3

function titleOf(article: NostrEvent): string {
  const tag = article.tags.find(candidate => candidate[0] === 'title')?.[1]?.trim()
  if (tag !== undefined && tag !== '') return tag
  // A title tag is SHOULD, not MUST.
  const firstLine = article.content.split('\n').find(line => line.trim() !== '')
  return firstLine === undefined ? 'Untitled' : firstLine.replace(/^#+\s*/, '').slice(0, 90)
}

function imageOf(article: NostrEvent): string | undefined {
  const image = article.tags.find(candidate => candidate[0] === 'image')?.[1]?.trim()
  // Same rule as note media: a URL in someone's event is a string a stranger chose.
  return image === undefined || image === '' || isPrivateUrl(image) ? undefined : image
}

/** How old a stored article list may be and still be shown while a fresh one loads. */
const ARTICLES_MAX_MS = 6 * 60 * 60_000

export function LatestArticles({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const profile = useProfile(pubkey)
  const now = useNowSeconds()

  const cachedFor = (): NostrEvent[] | undefined => undefined

  const query = useQuery({
    queryKey: ['latest-articles', pubkey],
    placeholderData: cachedFor,
    queryFn: async (): Promise<NostrEvent[]> => {
      /** Resolved when the relays that HAVE this author's articles have answered. */
      const found = await new Promise<NostrEvent[]>(resolve => {
        const events: NostrEvent[] = []
        let settled = false
        const finish = (): void => {
          if (settled) return
          settled = true
          clearTimeout(hard)
          clearTimeout(grace)
          handle.close()
          resolve(events)
        }
        // A relay with nothing to say EOSEs instantly, so "somebody answered" is not enough.
        let grace: ReturnType<typeof setTimeout> = setTimeout(() => {}, 0)
        const hard = setTimeout(finish, 8_000)
        const handle = getPool().subscribe({
          filters: [{ kinds: [30023], authors: [pubkey], limit: 60 }],
          onEvent: event => {
            events.push(event)
            clearTimeout(grace)
            grace = setTimeout(finish, 700)
          },
          onEose: () => {
            // Everybody finished.
            finish()
          },
          closeOnEose: true,
        })
      })
      const newest = new Map<string, NostrEvent>()
      for (const article of found) {
        const identifier = article.tags.find(tag => tag[0] === 'd')?.[1] ?? article.id
        const held = newest.get(identifier)
        if (held === undefined || article.created_at > held.created_at) {
          newest.set(identifier, article)
        }
      }
      return [...newest.values()].sort((a, b) => b.created_at - a.created_at)
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  })

  const articles = query.data ?? []

  /** The whole module disappears when there is nothing to show. */
  if (query.isPending) {
    return (
      <section className="mb-3 mr-3 rounded-lg border border-border bg-bg-elevated py-5" aria-hidden="true">
        <div className="px-5 text-xl font-bold text-text">Latest articles</div>
        <ul className="mt-3 space-y-3 px-5">
          {[0, 1, 2].map(row => (
            <li key={row} className="h-3 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
          ))}
        </ul>
      </section>
    )
  }
  if (articles.length === 0) return null

  const handle = profile?.name?.trim()
  const name = handle !== undefined && handle !== '' ? handle : profileDisplayName(profile ?? { pubkey })

  return (
    <section
      aria-labelledby="latest-articles-heading"
      className="mb-3 mr-3 rounded-lg border border-border bg-bg-elevated py-5"
    >
      <h2 id="latest-articles-heading" className="px-5 text-xl font-bold text-text">
        Latest articles
      </h2>

      <ul className="mt-2">
        {articles.slice(0, SHOWN).map(article => {
          const image = imageOf(article)
          return (
            <li key={article.id}>
              <Link
                href={noteHref(article)}
                className="flex gap-3 px-5 py-2.5 transition-colors hover:bg-bg-inset"
              >
                <span className="min-w-0 flex-1">
                  {/* Two lines, then clipped. */}
                  <span className="line-clamp-2 text-sm font-semibold leading-snug text-text">
                    {titleOf(article)}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-faint">
                    {now === 0 ? null : relativeTime(article.created_at, now)}
                  </span>
                </span>
                {/* Through `ArticleCover`, like every other article thumbnail: this one used. */}
                {image === undefined ? null : (
                  <ArticleCover
                    url={image}
                    author={pubkey}
                    icon={20}
                    className="size-12 shrink-0 rounded-md bg-bg-inset object-cover"
                  />
                )}
              </Link>
            </li>
          )
        })}
      </ul>

      {/* A button, not a link in prose. */}
      <div className="mt-3 px-5">
        <Link
          href={`/p/${npubOf(pubkey)}?tab=articles`}
          className={`${BUTTON_QUIET} w-full`}
          title={`See all articles from @${name}`}
        >
          <span className="min-w-0 truncate">See all articles from @{name}</span>
        </Link>
      </div>
    </section>
  )
}
