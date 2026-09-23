'use client'

import { Link } from './AppLink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { parseContent, profileDisplayName, splitMedia, type Hex, type NostrEvent } from '@nostrich/nostr'

import { getCachedEvent } from '../lib/event-cache'
import { isDeleted } from '../lib/deleted'
import { unwrapRepost } from '../lib/repost'
import { useTabParam } from '../lib/tab-param'
import { npubOf, relativeTime } from '../lib/format'
import {
  useNotifications,
  useNotificationsSeen,
  type NotificationItem,
} from '../lib/notifications'
import {
  actorSentence,
  useNotificationRows,
  MAX_FACES,
  useGroupNotifications,
  type NotificationGroup,
} from '../lib/notification-grouping'
import { useThreadMentions } from '../lib/thread-mentions'
import { useInteractions } from '../lib/interactions'
import { useAccountQualifier } from '../lib/connected-accounts'
import { prefetchProfiles, useNip05Verified } from '../lib/profiles'
import { useProfile } from '../lib/profiles'
import { COLUMN_ROW, PAGE, PAGE_TITLE, SCALED_BODY, TAB_ACTIVE, TAB_CELL, TAB_IDLE, TAB_LABEL, TAB_STRIP, TAB_STRIP_BLEED, TAB_STRIP_ROW, TAB_UNDERLINE } from '../lib/styles'
import { Avatar } from './Avatar'
import { ProfileHoverCard } from './ProfileHoverCard'
import { ChatBubbleIcon, PROFILE_PATH } from './icons'
import { InteractionIcon } from './InteractionIcon'
import { NoteCard } from './NoteCard'
import { MediaRail, NoteContent, NOTIFICATION_MEDIA_MAX_PX, PreviewImage } from './NoteContent'
import { ReactionMark } from './ReactionMark'
import {
  reactionFlavour,
  reactionMarkOf,
  reactionVerb,
  type ReactionMark as ReactionMarkData,
  type ReactionFlavour,
} from '../lib/reactions'
import { VerifiedBadge } from './VerifiedBadge'
import { QuotedBody, QuotedNote, plainText, quotePointer, quotedPieces } from './QuotedNote'
import { useNowSeconds } from './Clock'
import { sessionPubkey, useSession } from './SessionProvider'

/** Everything addressed to you, newest first. */

type TabId = 'all' | 'mentions'

const TABS: { id: TabId; label: string }[] = [
  /* "All Notifications", not "All": on a two-tab strip beside "Mentions", a two-letter. */
  { id: 'all', label: 'All Notifications' },
  { id: 'mentions', label: 'Mentions' },
]

/** Rows rendered at once, and how many more each scroll adds. */
const NOTIFICATION_PAGE = 30
const NOTIFICATION_CAP = 600

/** `active`. */
export function NotificationsScreen({ active = true }: { active?: boolean } = {}): React.ReactNode {
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const profile = useProfile(pubkey)
  /* Which account these landed on, when there is more than one to tell apart. */
  const qualifier = useAccountQualifier()
  const [tab, setTab] = useTabParam<TabId>(['all', 'mentions'], 'all')

  const { items, targets, targetsResolving, loading, newestAt, refetch } = useNotifications(
    pubkey,
    profile,
    // Only for the two signed requests behind server-sourced follower rows.
    session.status === 'signed' ? session.signer : undefined,
    /* WARM WHILE HIDDEN. */
    !active,
  )

  /** NOTHING TO SHOW IS WORTH ASKING TWICE. */
  const asked = useRef(false)
  useEffect(() => {
    if (loading || pubkey === undefined) return
    if (items.length > 0) {
      asked.current = false
      return
    }
    if (asked.current) return
    asked.current = true
    refetch()
  }, [loading, items.length, pubkey, refetch])
  const { markSeen } = useNotificationsSeen()
  const [grouped, setGrouped] = useGroupNotifications()
  const [threadMentions, setThreadMentions] = useThreadMentions()

  /** Interaction counts for the notes rendered as full cards. */
  const queryClient = useQueryClient()

  /** Opening the page IS reading. */
  useEffect(() => {
    // `active`: the screen outlives the visit now, and only the visit means "read".
    if (!active) return
    if (newestAt > 0) markSeen(newestAt)
  }, [active, newestAt, markSeen])

  const shown = useMemo(
    () =>
      // Quotes belong here too: someone writing about your note is the same class of thing.
      tab === 'mentions'
        ? items.filter(
            i =>
              i.kind === 'reply' || i.kind === 'mention' || i.kind === 'quote' || i.kind === 'thread',
          )
        : items,
    [items, tab],
  )

  /** One list of rows, whether or not grouping. */
  const rows = useNotificationRows(shown)

  const visibleRows = rows

  /** NAMES AND FACES, FETCHED BEFORE THE ROWS NEED THEM. */
  const warmKey = useMemo(() => {
    const people: Hex[] = []
    for (const { group, item } of visibleRows) {
      people.push(item.actor)
      if (group !== undefined) for (const member of group.items) people.push(member.actor)
      const target = targets.get(item.targetId ?? '')
      if (target !== undefined) people.push(target.pubkey as Hex)
    }
    return [...new Set(people)].slice(0, PREFETCH_PEOPLE).join(',')
  }, [visibleRows, targets])

  useEffect(() => {
    if (warmKey === '') return
    void prefetchProfiles(queryClient, warmKey.split(',') as Hex[])
  }, [warmKey, queryClient])

  /** Interaction counts for the cards ON SCREEN. */
  const cardIds = useMemo(
    () =>
      visibleRows
        .filter(
          ({ item }) =>
            item.kind === 'reply' ||
              item.kind === 'mention' ||
              item.kind === 'quote' ||
              item.kind === 'thread',
        )
        // Absent only on a follow row, which this filter has already excluded.
        .flatMap(({ item }) => (item.event === undefined ? [] : [item.event.id])),
    [visibleRows],
  )
  const { counts } = useInteractions(cardIds)

  if (pubkey === undefined) {
    return (
      <div className={PAGE}>
        <h1 className={PAGE_TITLE}>Notifications</h1>

        <p className={`mt-4 ${SCALED_BODY} text-text-muted`}>
          <Link href="/login" className="underline decoration-border-strong underline-offset-2">
            Sign in
          </Link>{' '}
          to see replies, mentions, reposts and zaps.
        </p>
      </div>
    )
  }

  return (
    <div className={PAGE}>
      {/* STACKED ON A PHONE. */}
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className={PAGE_TITLE}>Notifications</h1>
        <div className="flex shrink-0 items-center gap-2">
        {/* THREAD REPLIES FIRST, and in the header rather than on the Mentions tab. */}
        <button
          type="button"
          role="switch"
          aria-checked={threadMentions}
          onClick={() => setThreadMentions(!threadMentions)}
          title={
            threadMentions
              ? 'Including replies in threads you were tagged in'
              : 'Only people who replied to you or wrote your name'
          }
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border-strong px-3 py-1.5 text-sm font-semibold text-text transition-colors hover:bg-bg-inset"
        >
          <span
            aria-hidden="true"
            className={`relative h-4 w-7 rounded-full transition-colors ${
              threadMentions ? 'bg-text' : 'bg-border-strong'
            }`}
          >
            <span
              className={`absolute top-0.5 size-3 rounded-full bg-bg transition-all ${
                threadMentions ? 'left-3.5' : 'left-0.5'
              }`}
            />
          </span>
          Thread replies
        </button>
        {/* Beside the title, because it changes what the whole page IS rather than filtering. */}
        <button
          type="button"
          role="switch"
          aria-checked={grouped}
          onClick={() => setGrouped(!grouped)}
          title={grouped ? 'Showing one row per note' : 'Showing every notification separately'}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border-strong px-3 py-1.5 text-sm font-semibold text-text transition-colors hover:bg-bg-inset"
        >
          <span
            aria-hidden="true"
            className={`relative h-4 w-7 rounded-full transition-colors ${
              grouped ? 'bg-text' : 'bg-border-strong'
            }`}
          >
            <span
              className={`absolute top-0.5 size-3 rounded-full bg-bg transition-all ${
                grouped ? 'left-3.5' : 'left-0.5'
              }`}
            />
          </span>
          Group similar
        </button>
        </div>
      </div>

      <div className={`mt-4 ${TAB_STRIP} ${TAB_STRIP_BLEED}`}>
        <div role="tablist" aria-label="Notifications" className={TAB_STRIP_ROW}>
          {TABS.map(item => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
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

      {/** SKELETON UNTIL THE NOTES ARRIVE, not merely until there is SOMETHING to draw. */}
      {loading ? (
        <ul className="mt-2" aria-hidden="true">
          <SkeletonRows count={SKELETON_ROWS} />
        </ul>
      ) : shown.length === 0 ? (
        <p className={`px-1 py-10 text-center ${SCALED_BODY} text-text-muted`}>
          {tab === 'mentions'
            ? 'Nobody has replied to you or mentioned you yet.'
            : 'Nothing yet. Replies, mentions, reposts and zaps will appear here.'}
        </p>
      ) : (
        <ul className="mt-1">
          {visibleRows.map(({ group, item }) =>
            /** A reply, a mention or a quote is somebody's NOTE, so it renders as one. */
            item.kind === 'reply' ||
            item.kind === 'mention' ||
            item.kind === 'quote' ||
            item.kind === 'thread' ? (
              /* `hover:bg-bg-elevated` like every other row. */
              <li
                key={item.id}
                className={`border-b border-border transition-colors hover:bg-bg-elevated ${COLUMN_ROW}`}
              >
                {/* The SAME two columns as every other row: the interaction icon on the left. */}
                <div className="flex gap-3 pt-4">
                  {/* NO padding on this box. */}
                  <span className="flex size-10 shrink-0 items-center justify-start text-nav-icon">
                    {/* Reply gets the bubble. */}
                    {item.kind === 'reply' ? (
                      <ChatBubbleIcon size={26} />
                    ) : (
                      <span className="material-symbols-outlined text-[26px]!" aria-hidden="true">
                        alternate_email
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* The verb, because the card cannot say whether this was a reply, a mention or a quote. */}
                    <div className="text-[13px] text-text-muted">
                      {verbFor(item).before}
                      {qualifier === undefined ? null : ` on @${qualifier}`}
                    </div>
                    {/* `-mx-4 sm:-mx-5` cancels the card's own gutter so its avatar lines up with the icon. */}
                    <div className="-mx-4 sm:-mx-5">
                      {/* `tintQuote`: the quote inside this card is a third level. */}
                      {item.event === undefined ? null : (
                        <NoteCard
                          event={item.event}
                          counts={counts.get(item.event.id)}
                          tintQuote
                          quoteMediaCap={NOTIFICATION_MEDIA_MAX_PX}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ) : group !== undefined ? (
              <GroupRow
                key={group.key}
                group={group}
                target={targets.get(group.items[0]?.targetId ?? '')}
                resolving={targetsResolving}
              />
            ) : (
              <NotificationRow
                key={item.id}
                item={item}
                target={targets.get(item.targetId ?? '')}
                resolving={targetsResolving}
              />
            ),
          )}

        </ul>
      )}

    </div>
  )
}

const VERB: Record<NotificationItem['kind'], string> = {
  reply: 'replied to you',
  quote: 'quoted your note',
  mention: 'mentioned you',
  /* NOT "mentioned you". */
  thread: "replied in a thread you're in",
  // Overridden for a plain.
  reaction: 'reacted to your note',
  repost: 'reposted you',
  zap: 'zapped you',
  bookmark: 'bookmarked your note',
  follow: 'follows you',
}

/** The note a notification is ABOUT, drawn as the reader would recognise. */
/** The note a row. */
function TargetSlot({
  target,
  targetId,
  resolving,
  href,
}: {
  target: NostrEvent | undefined
  targetId: string | undefined
  resolving: boolean
  href: string
}): React.ReactNode {
  if (target !== undefined) return <TargetNote target={target} href={href} />
  if (targetId === undefined) return null
  /* A DELETED note is not a note that is still loading. */
  if (isDeleted(targetId)) {
    return <p className="mt-1.5 text-sm text-text-faint">The note this was for was deleted.</p>
  }
  /* RESERVED WHENEVER A NOTE IS NAMED, not only while a fetch is in flight. */
  void resolving
  /* TEXT LINES, not a box. */
  return (
    <div aria-hidden="true" className="mt-1.5 h-14 space-y-2 pt-1">
      <div className="h-3 w-full animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
      <div className="h-3 w-3/5 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
    </div>
  )
}

/** How many placeholder rows the page holds while it is still filling. */
/** People whose profile is warmed up front. */
const PREFETCH_PEOPLE = 80

const SKELETON_ROWS = 12

/** Fixed, not random. */
const SKELETON_WIDTHS = ['85%', '62%', '78%', '55%', '90%', '68%', '74%', '58%', '83%', '65%', '88%', '70%']

function SkeletonRows({ count }: { count: number }): React.ReactNode {
  if (count <= 0) return null
  return (
    <>
      {SKELETON_WIDTHS.slice(0, count).map((width, row) => (
        <li key={`skeleton-${row}`} className={`flex gap-3 border-b border-border py-4 ${COLUMN_ROW}`}>
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
    </>
  )
}

function TargetNote({ target, href }: { target: NostrEvent; href: string }): React.ReactNode {
  const pointer = useMemo(() => quotePointer(target), [target])
  /** THE PICTURE THEY LIKED, which this preview used to leave out entirely. */
  const media = useMemo(
    () => splitMedia(parseContent(target.content, target.tags)).media,
    [target],
  )
  const lone = media.length === 1 && media[0]?.type === 'image' ? media[0] : undefined

  return (
    /* CLAMPED, because this preview's job is identification and not reading. */
    /* NO BOX. */
    <Link href={href} className="mt-1.5 block text-sm text-text-muted">
      <span className="line-clamp-3">
        <NoteContent
          event={target}
          inert
          hideMedia
          {...(pointer === undefined ? {} : { hideEventIds: [pointer.id] })}
        />
      </span>
      {lone !== undefined ? (
        <PreviewImage
          url={lone.url}
          tags={target.tags}
          author={target.pubkey as Hex}
          cap={NOTIFICATION_MEDIA_MAX_PX}
        />
      ) : media.length === 0 ? null : (
        <MediaRail media={media} tags={target.tags} author={target.pubkey as Hex} inert timeline />
      )}
      {pointer === undefined ? null : (
        <span className="mt-2 block">
          {/* THE QUOTE KEEPS ITS PICTURE TOO. */}
          <QuotedNote pointer={pointer} asLink={false} tinted inert mediaCap={NOTIFICATION_MEDIA_MAX_PX} />
        </span>
      )}
    </Link>
  )
}

/** The sentence for a single row. */
function verbFor(item: NotificationItem): { before: string; after: string } {
  if (item.kind === 'reaction') return reactionVerb(reactionFlavour(item.content))
  return { before: VERB[item.kind], after: '' }
}

/** Material fallbacks for the kinds the app has no glyph of its own. */
/** THE ACTUAL EMOJI, in the icon column. */
function ReactionIcon({
  flavour,
  mark,
}: {
  flavour: ReactionFlavour
  mark?: ReactionMarkData
}): React.ReactNode {
  if (flavour === 'like') return <InteractionIcon name="like" size={26} />
  if (flavour === 'dislike') {
    return (
      <span className="material-symbols-outlined text-[26px]!" aria-hidden="true">
        mood_bad
      </span>
    )
  }
  if (mark !== undefined) {
    /* The size the whole icon column is now drawn. */
    return (
      <span className="text-[28px] leading-none">
        <ReactionMark mark={mark} />
      </span>
    )
  }
  return (
    <span className="material-symbols-outlined text-[26px]!" aria-hidden="true">
      mood
    </span>
  )
}

const ICON: Record<NotificationItem['kind'], string> = {
  reply: 'chat_bubble',
  /* The same `@` a mention gets. */
  quote: 'alternate_email',
  mention: 'alternate_email',
  /* NOT the `@`. */
  thread: 'forum',
  reaction: 'favorite',
  repost: 'repeat',
  zap: 'zap',
  bookmark: 'bookmark',
  follow: 'person_add',
}

function iconFor(item: NotificationItem): string {
  return ICON[item.kind]
}

/** No tints, and no fills. */

/** Several of the same thing, on the same note, as one row. */
export function GroupRow({
  group,
  target,
  resolving = false,
}: {
  group: NotificationGroup
  target: NostrEvent | undefined
  /** The targets query is still running, so a missing note may still be on its way. */
  resolving?: boolean
}): React.ReactNode {
  const now = useNowSeconds()
  // BEFORE the early return below.
  const qualifier = useAccountQualifier()
  const first = group.items[0]
  if (first === undefined) return null

  const href = first.targetId === undefined ? `/p/${npubOf(first.actor)}` : `/e/${first.targetId}`

  return (
    <li className={`border-b border-border transition-colors hover:bg-bg-elevated ${COLUMN_ROW}`}>
      <div className="flex gap-3 py-4">
        <span className="flex size-10 shrink-0 items-center justify-start text-nav-icon">
          {group.kind === 'repost' ? (
            <InteractionIcon name="repost" size={26} />
          ) : group.kind === 'zap' ? (
            <InteractionIcon name="zap" size={26} />
          ) : group.kind === 'reaction' ? (
            /* The group's most-sent mark. */
            <ReactionIcon flavour={group.flavour ?? 'like'} mark={group.marks?.[0]} />
          ) : group.kind === 'follow' ? (
            <svg viewBox="0 0 24 24" aria-hidden="true" width={26} height={26} className="shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={PROFILE_PATH} />
            </svg>
          ) : (
            <span className="material-symbols-outlined text-[26px]!" aria-hidden="true">
              {ICON[group.kind]}
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          {/* Faces first, then the sentence. */}
          <span className="flex flex-wrap items-center gap-1">
            {group.items.slice(0, MAX_FACES).map(item => (
              <GroupFace key={item.id} pubkey={item.actor} />
            ))}
          </span>

          <span className="mt-1.5 flex items-baseline gap-2">
            <Link href={href} className="min-w-0 flex-1 text-[15px] text-text">
              <GroupSentence group={group} />
              {/* Same rule as the single row. */}
              {qualifier === undefined ? null : (
                <span className="text-text-muted"> on @{qualifier}</span>
              )}
            </Link>
            <span className="shrink-0 text-xs text-text-faint">
              {now === 0 ? null : relativeTime(group.createdAt, now)}
            </span>
          </span>

          {/* The note they all acted on, so a row of ten faces is not a riddle. */}
          {/* Same for a group: the note itself, media included. */}
          {group.kind === 'follow' ? null : (
            <TargetSlot
              target={target}
              targetId={group.items[0]?.targetId}
              resolving={resolving}
              href={href}
            />
          )}
        </span>
      </div>
    </li>
  )
}

function GroupFace({ pubkey }: { pubkey: Hex }): React.ReactNode {
  const profile = useProfile(pubkey)
  return (
    <ProfileHoverCard pubkey={pubkey}>
    <Link href={`/p/${npubOf(pubkey)}`} aria-label={`${profileDisplayName(profile ?? { pubkey })}'s profile`}>
      <Avatar pubkey={pubkey} name={profileDisplayName(profile ?? { pubkey })} picture={profile?.picture} size="sm" />
    </Link>
    </ProfileHoverCard>
  )
}

function GroupSentence({ group }: { group: NotificationGroup }): React.ReactNode {
  // Only the named actors need a profile fetch.
  const firstProfile = useProfile(group.items[0]?.actor)
  const secondProfile = useProfile(group.items[1]?.actor)
  const names = [
    profileDisplayName(firstProfile ?? { pubkey: group.items[0]?.actor ?? ('' as Hex) }),
    profileDisplayName(secondProfile ?? { pubkey: group.items[1]?.actor ?? ('' as Hex) }),
  ]

  /* Reactions are worded by the same helper the single row and the push notification use. */
  const { before, after } =
    group.kind === 'reaction'
      ? reactionVerb(group.flavour ?? 'like')
      : {
          before:
            group.kind === 'repost'
              ? 'reposted you'
              : group.kind === 'zap'
                ? 'zapped you'
                : group.kind === 'follow'
                  ? 'follow you'
                  : 'bookmarked your note',
          after: '',
        }

  const marks = group.marks ?? []

  return (
    <>
      <span className="font-semibold">{actorSentence(names, group.items.length)}</span>{' '}
      <span className="text-text-muted">
        {before}
        {marks.length === 0 ? null : (
          <>
            {' '}
            {/* Labelled, because three <img> alts in a row read as gibberish to a screen reader. */}
            <span
              aria-label={`with ${marks.map(mark => mark.display).join(', ')}${
                group.moreMarks === undefined ? '' : ` and ${group.moreMarks} more`
              }`}
            >
              {marks.map(mark => (
                <ReactionMark key={mark.display} mark={mark} />
              ))}
              {group.moreMarks === undefined ? null : (
                <span className="ml-0.5 text-text-faint">+{group.moreMarks}</span>
              )}
            </span>
          </>
        )}
        {after === '' ? '' : ` ${after}`}
        {/* Summed, because ten zaps of 21 sats is one fact about 210 sats. */}
        {group.kind === 'zap' && group.totalSats !== undefined
          ? ` ${group.totalSats.toLocaleString()} sats`
          : ''}
      {/* NO "unconfirmed" LABEL. */}
      </span>
    </>
  )
}

/** A single notification's verb, with the reaction mark in the middle. */
function ReactionSentence({ item }: { item: NotificationItem }): React.ReactNode {
  const { before, after } = verbFor(item)

  return (
    <span className="flex shrink-0 items-center gap-1 text-text-muted">
      {/* No mark here any more: the icon column carries it, and printing it twice in one row. */}
      <span>{before}</span>
      {after === '' ? null : <span>{after}</span>}
      {item.kind === 'zap' && item.amountSats !== undefined
        ? `${item.amountSats.toLocaleString()} sats`
        : ''}
      {/* See the note above: no unconfirmed label on a notification. */}
    </span>
  )
}

/** One notification, as a row. */
export function NotificationRow({
  item,
  target,
  resolving = false,
}: {
  item: NotificationItem
  /** The note this is about, fetched rather than hoped. */
  target: NostrEvent | undefined
  /** The targets query is still running, so a missing note may still be on its way. */
  resolving?: boolean
}): React.ReactNode {
  const profile = useProfile(item.actor)
  const verified = useNip05Verified(profile?.nip05, item.actor)
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const qualifier = useAccountQualifier()
  /** A quoted note renders as a card here too. */
  /** A REPOST has no words of its own, and must never be read for any. */
  const isRepost = item.kind === 'repost'
  /* Absent only on a follow row, which never reaches the quote and body work below. */
  const source = unwrapRepost(item.event)
  const quoted = useMemo(
    () => (isRepost || source === undefined ? undefined : quotePointer(source)),
    [isRepost, source],
  )
  // The body with that pointer removed, so the quote is not also spelled out above.
  /* Parsed for EVERY row, not only the ones carrying a quote. */
  const pieces = useMemo(
    () => (isRepost || source === undefined ? null : quotedPieces(source)),
    [isRepost, source],
  )
  const body = useMemo(
    () =>
      isRepost || source === undefined ? '' : pieces === null ? (item.content ?? '') : plainText(source),
    [isRepost, pieces, item.content, source],
  )
  const now = useNowSeconds()
  const name = profileDisplayName(profile ?? { pubkey: item.actor })

  // A follow has no note to open, so every part of that row goes to the person.
  /* The note, not the envelope around. */
  const href =
    item.kind !== 'follow' && item.targetId !== undefined
      ? `/e/${source?.id ?? item.targetId}`
      : `/p/${npubOf(item.actor)}`

  return (
    /** Two destinations in one row, as two real anchors. */
    <li className={`border-b border-border transition-colors hover:bg-bg-elevated ${COLUMN_ROW}`}>
      <div className="flex gap-3 py-4">
        <span
          className="flex size-10 shrink-0 items-center justify-start text-nav-icon"
        >
          {/* The three that also appear under every note use the app's own geometry, so a repost. */}
          {item.kind === 'reply' ? (
            <ChatBubbleIcon size={26} />
          ) : item.kind === 'repost' ? (
            <InteractionIcon name="repost" size={26} />
          ) : item.kind === 'zap' ? (
            <InteractionIcon name="zap" size={26} />
          ) : item.kind === 'reaction' ? (
            <ReactionIcon
              flavour={reactionFlavour(item.content)}
              mark={reactionMarkOf(item.content, item.event?.tags ?? [])}
            />
          ) : item.kind === 'follow' ? (
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              width={26}
              height={26}
              className="shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={PROFILE_PATH} />
            </svg>
          ) : (
            <span className="material-symbols-outlined text-[26px]!" aria-hidden="true">
              {iconFor(item)}
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          {/* TWO LINES: the name, then what they did. */}
          <span className="flex items-center gap-2">
            {/* The same hover card the timeline's avatars. */}
            <ProfileHoverCard pubkey={item.actor}>
              <Link
                href={`/p/${npubOf(item.actor)}`}
                aria-label={`${name}'s profile`}
                className="shrink-0"
              >
                <Avatar pubkey={item.actor} name={name} picture={profile?.picture} size="sm" />
              </Link>
            </ProfileHoverCard>

            <Link href={href} className="min-w-0 flex-1">
              {/* A FLEX ROW, not inline text. */}
              <span className="flex min-w-0 items-center gap-1 text-[15px] text-text">
                <span className="truncate font-semibold">{name}</span>
                {verified ? <VerifiedBadge size={15} mine={item.actor === viewer} /> : null}
              </span>
              {/* "reacted 🤙 to your note". */}
              <span className="flex min-w-0 items-center gap-1 text-[13px] leading-tight text-text-muted">
                <ReactionSentence item={item} />
                {/* WHICH of your accounts this landed. */}
                {qualifier === undefined ? null : (
                  <span className="min-w-0 truncate">on @{qualifier}</span>
                )}
              </span>
            </Link>

            <span className="shrink-0 self-start text-xs text-text-faint">
              {now === 0 ? null : relativeTime(item.createdAt, now)}
            </span>
          </span>

          {/* A reaction has no body of its own. */}
          {item.kind === 'reaction' ? null : body.trim() !== '' ? (
            <Link
              href={href}
              className={`mt-1 block whitespace-pre-wrap break-words ${SCALED_BODY} leading-relaxed text-text`}
            >
              {pieces === null ? body : <QuotedBody pieces={pieces} />}
            </Link>
          ) : null}

          {/* Tinted for the same reason the card rows are: this quote sits under a row. */}
          {quoted !== undefined ? (
            <span className="block">
              <QuotedNote pointer={quoted} asLink={false} tinted mediaCap={NOTIFICATION_MEDIA_MAX_PX} />
            </span>
          ) : null}

          {/* The note they acted on, on EVERY row that has one, at WHATEVER length. */}
          {/* The note THEY acted on, rendered rather than flattened. */}
          {item.kind === 'reply' || item.kind === 'mention' || item.kind === 'thread' ? null : (
            <TargetSlot target={target} targetId={item.targetId} resolving={resolving} href={href} />
          )}
        </span>
      </div>
    </li>
  )
}
