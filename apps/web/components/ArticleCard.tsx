'use client'

import { parseLongForm, profileDisplayName, type NostrEvent } from '@nostrich/nostr'

import { useAddressEvent, type AddressPointer } from '../lib/addresses'
import { absoluteDate } from '../lib/format'
import { noteHref } from '../lib/links'
import { readingMinutes } from '../lib/markdown'
import { useProfile } from '../lib/profiles'
import { ArticleCover } from './ArticleCover'
import { Avatar } from './Avatar'
import { ContentLink } from './ContentLink'

/** A LONG-FORM ARTICLE, DRAWN AS A CARD. */

/** Neutral while the pointer resolves. */
function Skeleton(): React.ReactNode {
  return (
    <span className="mt-3 flex animate-pulse gap-3 rounded-2xl border border-border p-3">
      <span className="size-[88px] shrink-0 rounded-xl bg-bg-inset" />
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block h-4 w-3/4 rounded bg-bg-inset" />
        <span className="mt-2 block h-3 w-full rounded bg-bg-inset" />
        <span className="mt-2 block h-3 w-24 rounded bg-bg-inset" />
      </span>
    </span>
  )
}

/** The card's cover. */
function Cover({ url, alt, author }: { url: string; alt: string; author: string }): React.ReactNode {
  return (
    <ArticleCover
      url={url}
      author={author as never}
      alt={alt}
      icon={28}
      className="size-[88px] shrink-0 rounded-xl bg-bg-inset object-cover"
    />
  )
}

/** Resolves an `naddr` and draws. */
export function ArticleCard({ pointer }: { pointer: AddressPointer }): React.ReactNode {
  const { event, loading } = useAddressEvent(pointer)

  if (loading && event === undefined) return <Skeleton />
  /* Nothing rather than a broken card. */
  if (event === undefined) return null
  return <ArticleCardView event={event} />
}

/** The card itself, from an event somebody else already resolved. */
export function ArticleCardView({ event }: { event: NostrEvent }): React.ReactNode {
  const author = event.pubkey
  const profile = useProfile(author as never)

  const article = parseLongForm(event)
  const title = article.title?.trim()
  if (title === undefined || title === '') return null

  const name = profileDisplayName(profile ?? { pubkey: author as never })
  const tagline = article.summary?.trim()
  const minutes = readingMinutes(article.content)

  return (
    <ContentLink
      href={noteHref(event)}
      className="mt-3 flex gap-3 rounded-2xl border border-border p-3 transition-colors hover:bg-bg-inset"
    >
      {article.image === undefined ? null : (
        <Cover url={article.image} alt={title} author={author} />
      )}

      <span className="min-w-0 flex-1">
        {/* No `block` beside a clamp: `line-clamp-*` sets `display:-webkit-box` and a display utility silently. */}
        <span className="line-clamp-2 font-semibold leading-snug text-text">{title}</span>

        {/* ONE line, as asked. */}
        {tagline === undefined || tagline === '' ? null : (
          <span className="mt-1 line-clamp-1 text-sm text-text-muted">{tagline}</span>
        )}

        <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-faint">
          <Avatar pubkey={author as never} name={name} picture={profile?.picture} size="xs" />
          <span className="min-w-0 truncate">{name}</span>
          <span aria-hidden="true">·</span>
          {/* `publishedAt`, never `created_at`: an edit moves the revision timestamp, and a card. */}
          {/* Falls back to the event's own timestamp: `publishedAt` is optional on the parsed. */}
          <span>{absoluteDate(article.publishedAt ?? event.created_at)}</span>
          <span aria-hidden="true">·</span>
          <span>{minutes} min read</span>
        </span>
      </span>
    </ContentLink>
  )
}
