'use client'

import { Link } from './AppLink'
import {
  type Hex, parseLongForm, profileDisplayName, type NostrEvent } from '@nostrich/nostr'

import { ArticleCover } from './ArticleCover'
import { absoluteDate } from '../lib/format'
import { npubOf } from '../lib/format'
import { hashtagHref, profileHref } from '../lib/links'
import { readingMinutes } from '../lib/markdown'
import { useNip05Verified, useProfile } from '../lib/profiles'
import { Avatar } from './Avatar'
import { BackBar } from './BackBar'
import { FollowButton } from './FollowButton'
import { InteractionBar } from './InteractionBar'
import { ZapStrip } from './ZapStrip'
import type { ZapDetail } from '../lib/interactions'
import { MarkdownBody } from './MarkdownBody'
import { NoteMenu } from './NoteMenu'
import { VerifiedBadge } from './VerifiedBadge'
import { sessionPubkey, useSession } from './SessionProvider'
import type { NoteCounts } from '@nostrich/app'

/** A NIP-23 article, read rather than dumped. */
/** The article's own cover. */
function Cover({ url, author }: { url: string; author: Hex }): React.ReactNode {
  return (
    <ArticleCover
      url={url}
      author={author}
      eager
      icon={40}
      className="mt-6 block aspect-[16/9] w-full rounded-xl bg-bg-inset object-cover"
    />
  )
}

export function ArticleScreen({
  event,
  counts,
  zaps,
}: {
  event: NostrEvent
  counts?: NoteCounts
  /** Individual zaps on this article, for the strip above the actions. */
  zaps?: readonly ZapDetail[]
}): React.ReactNode {
  const article = parseLongForm(event)
  const profile = useProfile(event.pubkey)
  const verified = useNip05Verified(profile?.nip05, event.pubkey)
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const name = profileDisplayName({ ...profile, pubkey: event.pubkey })
  const npub = npubOf(event.pubkey)

  return (
    <article className="px-4 pb-10 pt-3 sm:px-5">
      <BackBar label="Articles" href="/articles" />

      {/* Title first and largest. */}
      <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-text sm:text-[38px]">
        {article.title}
      </h1>

      {article.summary !== undefined && article.summary.trim() !== '' ? (
        <p className="mt-3 text-lg leading-relaxed text-text-muted">{article.summary}</p>
      ) : null}

      {/* Author, then the two facts that decide whether this gets read now or later. */}
      <div className="mt-5 flex items-center gap-3">
        <Link href={profileHref(npub)} className="shrink-0">
          <Avatar pubkey={event.pubkey} name={name} picture={profile?.picture} size="lg" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={profileHref(npub)} className="flex min-w-0 items-center gap-1">
            <span className="truncate font-bold text-text hover:underline">{name}</span>
            {verified ? <VerifiedBadge size={16} mine={event.pubkey === viewer} /> : null}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
            <span>{absoluteDate(article.publishedAt ?? event.created_at)}</span>
            <span aria-hidden="true">·</span>
            <span>{readingMinutes(article.content)} min read</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {event.pubkey === viewer ? null : <FollowButton target={event.pubkey} />}
          <NoteMenu event={event} />
        </div>
      </div>

      {/* Cover, full width. */}
      {article.image !== undefined && article.image.trim() !== '' ? (
        <Cover url={article.image} author={event.pubkey as Hex} />
      ) : null}

      <div className="mt-5 border-y border-border py-1">
        <ZapStrip zaps={zaps ?? []} noteId={event.id} />
        <InteractionBar event={event} counts={counts} />
      </div>

      <div className="mt-7">
        <MarkdownBody source={article.content} />
      </div>

      {article.hashtags.length > 0 ? (
        <div className="mt-8 flex flex-wrap gap-2">
          {article.hashtags.slice(0, 12).map(tag => (
            <Link
              key={tag}
              href={hashtagHref(tag)}
              className="rounded-lg bg-bg-inset px-2.5 py-1 text-sm text-text-muted transition-colors hover:bg-border hover:text-text"
            >
              #{tag}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-8 border-y border-border py-1">
        <ZapStrip zaps={zaps ?? []} noteId={event.id} />
        <InteractionBar event={event} counts={counts} />
      </div>
    </article>
  )
}
