'use client'

import { use, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  eventAddress,
  conversationKeyOf,
  isPrivateUrl,
  isReply,
  KINDS,
  parseContent,
  profileDisplayName,
  profileHandle,
  type Hex,
  type NostrEvent,
} from '@nostrich/nostr'

import { asset } from '../lib/assets'
import { useTabParam } from '../lib/tab-param'
import { useRouter } from 'next/navigation'

import { useFollowsYou } from '../lib/contacts'
import { getPool } from '../lib/pool'
import { ContentLink } from './ContentLink'
import { NoteContent } from './NoteContent'
import { linkifyHandles } from '../lib/handle-mentions'
import { usePinnedId } from '../lib/pinned'
import { useProfileTotals } from '../lib/profile-totals'
import { claimCelebration, isJoinAnniversary } from '../lib/anniversary'
import { useHydrated } from '../lib/hydrated'
import { launchBalloons, SETTLE_MS } from '../lib/balloons'
import { useJoinedAt } from '../lib/joined'
import { resolveEntity } from '../lib/entity'
import { useFeed, type FeedSource } from '../lib/feed'
import { useInteractions } from '../lib/interactions'
import { rememberProfileVisit } from '../lib/recent-searches'
import { ZapStrip } from './ZapStrip'
import { isDeleted, useDeletedVersion } from '../lib/deleted'
import { countedId } from '../lib/reposts'
import { displayKey, floorCount, joinedMonth, npubOf, relativeTime } from '../lib/format'
import { Link } from './AppLink'

import { hashtagHref, noteHref } from '../lib/links'
import { InteractionBar } from './InteractionBar'
import { useNowSeconds } from './Clock'
import { useNip05Verified, useProfile } from '../lib/profiles'
import {
  LINK,
  LINK_LABEL,
  LINK_WITH_ICON,
  TAB_ACTIVE,
  TAB_CELL_TIGHT,
  TAB_IDLE,
  TAB_LABEL,
  TAB_STRIP,
  TAB_STRIP_ROW_TIGHT,
  TAB_UNDERLINE,
} from '../lib/styles'
import { ArticleCover } from './ArticleCover'
import { Avatar } from './Avatar'
import { FollowedBy } from './FollowedBy'
import { InteractionIcon } from './InteractionIcon'
import { useParents } from '../lib/parents'
import { useProfileZaps } from '../lib/profile-zaps'
import { useUserList } from '../lib/user-lists'
import { FollowsDialog } from './FollowsDialog'
import { ProfileQrButton, ProfileQrDialog } from './ProfileQrDialog'
import { ProfileZapsTab } from './ProfileZapsTab'
import { ZapDialog } from './ZapDialog'
import { VerifiedBadge } from './VerifiedBadge'
import { useBlossomSrc } from '../lib/blossom-retry'
import { ChatBubbleIcon } from './icons'
import { NoteCard } from './NoteCard'
import { Threaded } from './Threaded'
import { FollowButton } from './FollowButton'
import { ProfileEditor } from './ProfileEditor'
import { ProfileMenu } from './ProfileMenu'
import { sessionPubkey, useSession } from './SessionProvider'

/** Notes rendered on a profile before the reader has to scroll for more, and the size. */
const NOTE_LIMIT = 40

/** Where rendering stops regardless of how far somebody scrolls, matching `FeedScreen`. */
const RENDER_CAP = 600

/** The meta row's fit ladder. */
const FIT_STEPS = 3

/** Server render has no layout, so it starts at the top of the ladder and steps down. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function useFitStep(content: string): [number, React.RefObject<HTMLDivElement | null>] {
  const ref = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)

  // Counts arrive from relays a second after the page does, and a longer number needs.
  useIsomorphicLayoutEffect(() => setStep(0), [content])

  useIsomorphicLayoutEffect(() => {
    const node = ref.current
    if (node === null || step >= FIT_STEPS - 1) return
    // A pixel of slack: sub-pixel text metrics make scrollWidth exceed clientWidth.
    if (node.scrollWidth > node.clientWidth + 1) setStep(current => current + 1)
  })

  useEffect(() => {
    const parent = ref.current?.parentElement
    if (parent === undefined || parent === null || typeof ResizeObserver === 'undefined') return
    // The PARENT, not the row.
    let last = Math.round(parent.getBoundingClientRect().width)
    const observer = new ResizeObserver(entries => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0)
      if (width === last) return
      last = width
      setStep(0)
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  return [step, ref]
}

export function ProfileScreen({ params }: { params: Promise<{ id: string }> }): React.ReactNode {
  const { id } = use(params)
  const entity = useMemo(() => resolveEntity(id, 'profile'), [id])
  const pubkey = entity?.hex

  const { session } = useSession()
  const viewer = sessionPubkey(session)

  const profile = useProfile(pubkey)

  /** Remembered as somewhere the reader went, for the Recent list under the search field. */
  useEffect(() => {
    rememberProfileVisit(pubkey)
  }, [pubkey])
  const verified = useNip05Verified(profile?.nip05, pubkey ?? "")
  /** Undefined only for an account that set neither a name nor a NIP-05 address. */
  const handle = profileHandle(profile)
  // Counted, never estimated.
  /** The index that can answer everything, when it answers. */

  // A profile feed is the one place an author filter is the whole point, so it needs.
  const source = useMemo<FeedSource | null>(
    // `include: 'all'` keeps replies, which the timeline drops.
    () => (pubkey === undefined ? null : { kind: 'authors', authors: [pubkey], include: 'all' }),
    [pubkey],
  )
  const feed = useFeed(source ?? { kind: 'authors', authors: [] }, source !== null)
  /** Reply / like / repost / zap counts for the notes on screen. */
  const deletedVersion = useDeletedVersion()
  const [tab, setTab] = useTabParam<ProfileTabId>(
    ['posts', 'replies', 'reposts', 'articles', 'media', 'zaps'],
    'posts',
  )

  /** One fetch, four views. */
  const partitioned = useMemo(() => {
    /** PENDING notes are shown, not held. */
    const live = [...feed.notes, ...feed.pending]
      .filter(note => !isDeleted(note.id))
      .sort((a, b) => b.created_at - a.created_at)
    const posts: NostrEvent[] = []
    const replies: NostrEvent[] = []
    const reposts: NostrEvent[] = []
    const media: NostrEvent[] = []

    for (const note of live) {
      if (note.kind === KINDS.repost) {
        reposts.push(note)
        continue
      }
      if (isReply(note)) replies.push(note)
      else posts.push(note)
      // Media is a cut across the other tabs rather than a bucket of its own: a photo.
      if (hasMedia(note)) media.push(note)
    }
    return { posts, replies, reposts, media }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deletedVersion is the signal
  }, [feed.notes, feed.pending, deletedVersion])

  const zaps = useProfileZaps(pubkey, profile, tab === 'zaps')

  /* The reader's own mute lists, read here only to EXPLAIN an empty tab. */
  const muted = useUserList('muted')
  const mutedReposts = useUserList('mutedReposts')
  // `pubkey` is undefined until the npub in the route resolves.
  const hiddenByMute = pubkey !== undefined && muted.has(pubkey)
  const repostsHidden = pubkey !== undefined && mutedReposts.has(pubkey)

  /** The pinned note, hoisted to the top of Posts. */
  const pinnedId = usePinnedId(pubkey)
  const pinnedFromFeed = useMemo(
    () => (pinnedId === undefined ? undefined : feed.notes.find(note => note.id === pinnedId)),
    [feed.notes, pinnedId],
  )
  const pinnedQuery = useQuery({
    queryKey: ['pinned-note', pinnedId ?? ''],
    queryFn: async (): Promise<NostrEvent | null> => {
      if (pinnedId === undefined) return null
      const found = await getPool().query([{ ids: [pinnedId] }], undefined, 6_000)
      return found.find(note => note.id === pinnedId) ?? null
    },
    enabled: pinnedId !== undefined && pinnedFromFeed === undefined,
    staleTime: 10 * 60_000,
  })
  const pinnedNote =
    pinnedId === undefined || isDeleted(pinnedId)
      ? undefined
      : (pinnedFromFeed ?? pinnedQuery.data ?? undefined)

  const tabNotes = useMemo(() => {
    const list =
      tab === 'replies'
        ? partitioned.replies
        : tab === 'reposts'
          ? partitioned.reposts
          : tab === 'media'
            ? partitioned.media
            : partitioned.posts
    // The pin is rendered separately above, so it must not also appear in the list below.
    return tab === 'posts' && pinnedId !== undefined
      ? list.filter(note => note.id !== pinnedId)
      : list
  }, [tab, partitioned, pinnedId])

  /** How many of `tabNotes` are on screen. */
  const [visible, setVisible] = useState(NOTE_LIMIT)
  useEffect(() => {
    setVisible(NOTE_LIMIT)
  }, [tab, pubkey])

  const shownNotes = useMemo(() => tabNotes.slice(0, visible), [tabNotes, visible])

  /** Reveal another page, and fetch one when there is nothing left to reveal. */
  const sentinelRef = useRef<HTMLDivElement>(null)
  const heldRef = useRef(0)
  heldRef.current = tabNotes.length
  const loadMoreRef = useRef(feed.loadMore)
  loadMoreRef.current = feed.loadMore

  // Reads and Zaps run their own queries and are not slices of this feed, so they must.
  const paginates = tab !== 'articles' && tab !== 'zaps'

  /** The browser tab says WHOSE profile. */
  const tabTitle = useMemo((): string | undefined => {
    if (pubkey === undefined) return undefined
    // Nothing until the profile arrives: a title built from the fallback would flash.
    if (profile === undefined || profile === null) return undefined
    const shown = profileDisplayName(profile)
    const handle = profile.name?.trim()
    return handle === undefined || handle === '' || handle === shown
      ? `${shown} | Nostrich`
      : `${shown} (@${handle}) | Nostrich`
  }, [profile, pubkey])

  useEffect(() => {
    if (tabTitle === undefined) return
    document.title = tabTitle
  }, [tabTitle])

  /** Reset on UNMOUNT only, which is why it is a second effect with an empty dependency. */
  useEffect(
    () => () => {
      document.title = 'Nostrich'
    },
    [],
  )

  useEffect(() => {
    const node = sentinelRef.current
    if (!paginates || node === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (entry === undefined || !entry.isIntersecting) return
        setVisible(current => {
          if (heldRef.current > current) return Math.min(current + NOTE_LIMIT, RENDER_CAP)
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

  /** On Replies, the note each reply is answering. */
  const parents = useParents(tab === 'replies' ? shownNotes : EMPTY_NOTES)

  const noteIds = useMemo(
    // The pinned note is rendered outside `shownNotes`, so without it here its reply.
    () => [
      ...shownNotes.map(countedId),
      ...[...parents.values()].map(countedId),
      ...(pinnedNote === undefined ? [] : [countedId(pinnedNote)]),
    ],
    [shownNotes, parents, pinnedNote],
  )
  const { counts, zaps: noteZaps } = useInteractions(noteIds)

  // ABOVE the guard, not below.
  const joined = useJoinedAt(pubkey)

  /** Balloons, on the anniversary of the day this account joined Nostr. */
  useEffect(() => {
    if (pubkey === undefined) return
    /* Read from `location`, not from `useSearchParams`. */
    const forced = new URLSearchParams(window.location.search).get('balloons') === '1'
    if (!forced) {
      if (!isJoinAnniversary(joined, new Date())) return
      // Claims the four-hour window as it answers.
      if (!claimCelebration(pubkey)) return
    }
    /* AFTER THE PAGE HAS SETTLED, not the instant it decides. */
    const timer = setTimeout(launchBalloons, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [pubkey, joined])
  /** The header's two numbers, index first. */
  // The rule itself lives in `useProfileTotals`, shared with the hover card so the two.
  const totals = useProfileTotals(pubkey)
  const followingTotal = totals.following
  const followerTotal = totals.followers

  /** SHOWN AS SOON AS EITHER SOURCE HAS A NUMBER, not when both have finished. */
  const followerReady = totals.followersReady

  /** Which rung of the meta row's ladder this profile lands. */
  const [fit, metaRef] = useFitStep(
    `${totals.followingReady ? followingTotal : -1}|${followerReady ? followerTotal : -1}|${
      totals.followersCapped ? '+' : ''
    }`,
  )
  const metaRowClass = `flex flex-nowrap items-center text-text-muted ${
    fit === 0 ? 'gap-x-5 text-sm' : fit === 1 ? 'gap-x-3 text-[13px]' : 'gap-x-2.5 text-[13px]'
  }`
  /** Exact while there is room. */
  const metaCount = (n: number): string => (fit <= 1 ? n.toLocaleString() : floorCount(n))

  const followsYou = useFollowsYou(pubkey, viewer)
  const [editing, setEditing] = useState(false)
  const [showingQr, setShowingQr] = useState(false)
  const [connections, setConnections] = useState<'following' | 'followers' | null>(null)
  const signer = session.status === 'signed' ? session.signer : undefined
  const queryClient = useQueryClient()
  const hydrated = useHydrated()

  if (entity === null || pubkey === undefined) {
    return (
      <p className="px-4 py-10 text-center text-sm text-text-muted sm:px-5">
        That is not a profile identifier. Links to a profile look like <code>npub1…</code> or{' '}
        <code>nprofile1…</code>.
      </p>
    )
  }

  /** THE SERVER AND THE FIRST CLIENT RENDER AGREE, and they agree. */
  if (!hydrated) return <ProfileShell />

  const name = profileDisplayName(profile ?? { pubkey })
  const acceptsZaps = profile?.lud16 !== undefined || profile?.lud06 !== undefined
  const isSelf = viewer === pubkey

  return (
    <>
      {editing && signer !== undefined ? (
        <ProfileEditor
          pubkey={pubkey}
          profile={profile}
          signer={signer}
          onClose={() => setEditing(false)}
          // The kind-0 we just published is the newest, so the cached copy is stale.
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['profile', pubkey] })}
        />
      ) : null}

      {connections !== null ? (
        <FollowsDialog
          pubkey={pubkey}
          initialTab={connections}
          followingTotal={followingTotal}
          followersTotal={followerTotal}
          onClose={() => setConnections(null)}
        />
      ) : null}

      {showingQr ? (
        <ProfileQrDialog
          pubkey={pubkey}
          profile={profile}
          verified={verified}
          onClose={() => setShowingQr(false)}
        />
      ) : null}

      <header className="border-b border-border">
        {/* Edge to edge. */}
        {profile?.banner !== undefined && profile.banner !== '' && !isPrivateUrl(profile.banner) ? (
          <ProfileBanner url={profile.banner} />
        ) : (
          <div className="h-28 w-full bg-gradient-to-br from-accent-subtle to-bg-inset" />
        )}

        <div className="min-w-0 px-4 sm:px-5">
          {/* Avatar rides the banner's edge. */}
          <div className="flex items-end justify-between gap-3">
            <span className="-mt-12 shrink-0 rounded-full ring-4 ring-bg sm:-mt-16">
              <ProfileAvatar pubkey={pubkey} name={name} picture={profile?.picture} />
            </span>
            {/* `self-start` with an explicit top margin, not the row's `items-end`. */}
            <div className="mt-4 flex items-center gap-2 self-start sm:mt-5">
              <ProfileMenu pubkey={pubkey} />
              <ProfileQrButton onClick={() => setShowingQr(true)} />
              {isSelf ? null : <ChatButton target={pubkey} />}
              {/* ZAP is desktop-only in this row. */}
              {/* NOT ON YOUR OWN PROFILE. */}
              {acceptsZaps && !isSelf ? (
                <span className="hidden sm:block">
                  <ZapButton address={profile?.lud16 ?? profile?.lud06 ?? ''} target={pubkey} />
                </span>
              ) : null}
              {/* Your own profile gets Edit where a stranger's gets Follow: the same slot. */}
              {isSelf ? (
                signer === undefined ? null : (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    // rounded-lg, matching Follow, Zap, Chat and the overflow menu it sits beside.
                    className="rounded-lg border border-border-strong px-4 py-2 text-sm font-bold text-text transition-colors hover:bg-bg-inset"
                  >
                    Edit profile
                  </button>
                )
              ) : (
                <FollowButton target={pubkey} />
              )}
            </div>
          </div>

          <div className="mt-3">
            <h1 className="flex min-w-0 items-center gap-1.5 text-xl font-extrabold tracking-tight text-text">
              <span className="truncate">{name}</span>
              {verified ? (
                <VerifiedBadge size={18} mine={pubkey === viewer} />
              ) : null}
            </h1>
            <p className="flex min-w-0 items-center gap-2 text-[15px] text-text-muted">
              <span className="min-w-0 truncate">
                {handle !== undefined ? (
                  /* Their handle, the same one the timeline, the hover card and the rail show. */
                  `@${handle}`
                ) : (
                  <span className="font-mono text-sm text-text-faint" title={npubOf(pubkey)}>
                    {displayKey(pubkey)}
                  </span>
                )}
              </span>
              {/* Only when their contact list says. */}
              {followsYou === true ? (
                <span className="shrink-0 rounded-md bg-bg-inset px-1.5 py-0.5 text-xs font-medium text-text-muted">
                  Follows you
                </span>
              ) : null}
            </p>
          </div>

          {/* Parsed, not printed. */}
          {profile?.about !== undefined && profile.about !== '' ? (
            <div className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text">
              <NoteContent
                event={{
                  ...EMPTY_EVENT,
                  /* `@handle` is not a mention. */
                  content: linkifyHandles(profile.about),
                  pubkey: pubkey ?? EMPTY_EVENT.pubkey,
                }}
                hideMedia
              />
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-text-muted">
            {profile?.website !== undefined && profile.website !== '' ? (
              <ContentLink
                href={profile.website}
                className={`${LINK_WITH_ICON} inline-flex min-w-0 items-center gap-1.5`}
              >
                {/* The underline belongs to the words, not to the chain glyph beside them. */}
                <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">link</span>
                <span className={`truncate ${LINK_LABEL}`}>
                  {profile.website.replace(/^https?:\/\//, '')}
                </span>
              </ContentLink>
            ) : null}
            {/* Beside the website, not above it with the follow counts. */}
            {joined === undefined ? null : (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
                  calendar_month
                </span>
                Joined {joinedMonth(joined)}
              </span>
            )}
            {/* The lightning address is NOT shown here. */}
          </div>

          {/* Under the follow counts, which is where the eye already is after reading them. */}
          {pubkey === undefined ? null : <FollowedBy pubkey={pubkey} viewer={viewer} />}

          {/* ONE LINE, at every width, for every account. */}
          <div className="mb-4 mt-3">
            <div ref={metaRef} className={metaRowClass}>
              {/* Both open the same dialog, on the tab that was clicked. */}
              {totals.followingReady ? (
                <button
                  type="button"
                  onClick={() => setConnections('following')}
                  className="shrink-0 cursor-pointer whitespace-nowrap hover:underline"
                  /* The exact figure, always, whatever the row had room to draw. */
                  aria-label={`${followingTotal.toLocaleString()} following`}
                >
                  <strong className="text-text">{metaCount(followingTotal)}</strong> Following
                </button>
              ) : null}
              {/* Not `followers.loading || indexPending`. */}
              {!followerReady ? null : (
                <button
                  type="button"
                  onClick={() => setConnections('followers')}
                  className="shrink-0 cursor-pointer whitespace-nowrap hover:underline"
                  aria-label={`${followerTotal.toLocaleString()}${
                    totals.followersCapped ? ' or more' : ''
                  } followers`}
                  title={
                    totals.followersAreNetworkWide
                      ? 'Network-wide total.'
                      : 'Counted from the contact lists your relays hold. A floor, not a network total.'
                  }
                >
                  <strong className="text-text">
                    {metaCount(followerTotal)}
                    {/* The "+" says "at least this many" and belongs only on the relay floor. */}
                    {totals.followersCapped ? '+' : ''}
                  </strong>{' '}
                  Followers
                </button>
              )}
              {/* The follower number is a FLOOR. */}
            </div>
          </div>
        </div>
      </header>

      <ProfileTabs active={tab} onChange={setTab} />

      {tab === 'articles' ? (
        <ArticlesTab pubkey={pubkey} />
      ) : tab === 'zaps' ? (
        <ProfileZapsTab zaps={zaps} />
      ) : tab === 'media' ? (
        <MediaGrid notes={shownNotes} loading={feed.loading} />
      ) : feed.notes.length === 0 && feed.loading ? (
        <ProfileNotesSkeleton />
      ) : shownNotes.length === 0 ? (
        /* WHY it is empty, when the reason is the reader's own doing. */
        <p className="px-4 py-10 text-center text-sm text-text-muted sm:px-5">
          {hiddenByMute
            ? 'You muted this account, so their notes are hidden here. Unmute from the ··· menu above to see them.'
            : tab === 'reposts' && repostsHidden
              ? 'You hid this account’s reposts. Unhide from the ··· menu above to see them.'
              : EMPTY_COPY[tab]}
        </p>
      ) : (
        <>
          {tab === 'posts' && pinnedNote !== undefined ? (
            <div>
              {/* Labelled, because an out-of-order note at the top of a reverse-chronological list. */}
              <div className="flex items-center gap-2 px-4 pt-3 text-[13px] font-bold text-text-muted sm:px-5">
                <span className="material-symbols-outlined text-[17px]!" aria-hidden="true">
                  keep
                </span>
                Pinned
              </div>
              <NoteCard event={pinnedNote} counts={counts.get(countedId(pinnedNote))} zaps={noteZaps.get(countedId(pinnedNote))} />
            </div>
          ) : null}
          {shownNotes.map((event, index) => {
            const parent = parents.get(event.id)
            /* A self-thread is drawn once, not twice. */
            const shownAbove = index > 0 && parents.get(shownNotes[index - 1]?.id ?? '')?.id === event.id
            if (shownAbove) return null
            return parent === undefined ? (
              <NoteCard key={event.id} event={event} counts={counts.get(countedId(event))} zaps={noteZaps.get(countedId(event))} />
            ) : (
              <div key={event.id}>
                {/* `connected`: the rail runs from the parent's avatar into the answer's, so the two. */}
                <Threaded connected>
                  <NoteCard event={parent} counts={counts.get(countedId(parent))} zaps={noteZaps.get(countedId(parent))} />
                </Threaded>
                <NoteCard event={event} counts={counts.get(countedId(event))} zaps={noteZaps.get(countedId(event))} />
              </div>
            )
          })}
        </>
      )}

      {paginates ? (
        <>
          <div ref={sentinelRef} aria-hidden="true" className="h-px" />

          {/* Three different endings, because they mean different things to the reader: more. */}
          {shownNotes.length >= RENDER_CAP ? (
            <p className="pb-6 text-center text-xs text-text-faint">
              Showing the {RENDER_CAP} most recent notes. Reload to start a fresh window.
            </p>
          ) : feed.loadingMore ? (
            <p className="pb-6 pt-2 text-center text-xs text-text-faint">Loading older notes…</p>
          ) : feed.exhausted && shownNotes.length > 0 ? (
            <p className="pb-6 pt-2 text-center text-xs text-text-faint">
              That is everything your relays have for this profile.
            </p>
          ) : null}
        </>
      ) : null}
    </>
  )
}

/** Long-form articles, NIP-23 kind-30023. Its own query rather than a slice. */
function ArticlesTab({ pubkey }: { pubkey: Hex | undefined }): React.ReactNode {
  // Zero until the shared clock starts, which is what keeps the server render.
  const now = useNowSeconds()
  const query = useQuery({
    queryKey: ['profile-articles', pubkey ?? ''],
    queryFn: async (): Promise<NostrEvent[]> => {
      if (pubkey === undefined) return []
      /* SILENCE IS NOT "NO ARTICLES". */
      const outcome = await getPool().queryWithStatus(
        [{ kinds: [30023], authors: [pubkey], limit: 100 }],
        undefined,
        10_000,
      )
      if (outcome.answered === 0) throw new Error('no relay answered the article query')
      const found = outcome.events
      // Addressable: one live version per `d` tag, newest wins.
      const newest = new Map<string, NostrEvent>()
      for (const event of found) {
        const identifier = event.tags.find((tag: readonly string[]) => tag[0] === 'd')?.[1] ?? event.id
        const held = newest.get(identifier)
        if (held === undefined || event.created_at > held.created_at) newest.set(identifier, event)
      }
      return [...newest.values()].sort((a, b) => b.created_at - a.created_at)
    },
    enabled: pubkey !== undefined,
    staleTime: 10 * 60_000,
  })

  const articles = query.data ?? []

  /** Counts for the rows, asked for BY ADDRESS as well as by id. */
  const articleIds = useMemo(() => articles.map(article => article.id), [articles])
  const addresses = useMemo(
    () => new Map(articles.map(article => [eventAddress(article), article.id])),
    [articles],
  )
  const { counts, zaps: articleZaps } = useInteractions(articleIds, { addresses })

  if (query.isPending) return <ProfileNotesSkeleton />

  /** "COULD NOT REACH THE RELAYS" IS NOT "HAS NO ARTICLES". */
  if (query.isError && articles.length === 0) {
    return (
      <div className="px-4 py-10 text-center sm:px-5">
        <p className="text-sm text-text-muted">
          Could not reach the relays that carry long-form articles.
        </p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className={`mt-3 ${LINK}`}
        >
          Try again
        </button>
      </div>
    )
  }
  if (articles.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-text-muted sm:px-5">{EMPTY_COPY.articles}</p>
    )
  }

  return (
    <ul>
      {articles.map((article: NostrEvent) => {
        const tagValue = (name: string): string | undefined =>
          article.tags.find((tag: readonly string[]) => tag[0] === name)?.[1]
        const title = tagValue('title') ?? 'Untitled'
        const summary = tagValue('summary') ?? ''
        const image = tagValue('image')
        /* NIP-23 makes `published_at` optional, and it is the date the AUTHOR meant. */
        const publishedAt = Number(tagValue('published_at') ?? '') || article.created_at
        const hashtags = [
          ...new Set(
            article.tags
              .filter((tag: readonly string[]) => tag[0] === 't' && typeof tag[1] === 'string')
              .map((tag: readonly string[]) => (tag[1] as string).toLowerCase()),
          ),
        ]
        return (
          <li key={article.id} className="border-b border-border px-4 py-4 sm:px-5">
            {/* The words link. */}
            <Link href={noteHref(article)} className="flex gap-3 transition-opacity hover:opacity-90">
              <span className="min-w-0 flex-1">
                {/* An article title is a headline, not a row label. */}
                <span className="block text-[18px] font-bold leading-snug text-text">{title}</span>
                {summary === '' ? null : (
                  <span className="mt-1 line-clamp-2 text-sm text-text-muted">{summary}</span>
                )}
                <span className="mt-1.5 block text-xs text-text-faint">{relativeTime(publishedAt, now)}</span>
              </span>
              {image === undefined || isPrivateUrl(image) ? null : (
                <ArticleCover
                  url={image}
                  author={article.pubkey}
                  icon={24}
                  className="size-20 shrink-0 rounded-md bg-bg-inset object-cover"
                />
              )}
            </Link>

            {hashtags.length === 0 ? null : (
              <p className="mt-2 flex flex-wrap gap-2">
                {hashtags.slice(0, 4).map(tag => (
                  <Link
                    key={tag}
                    href={hashtagHref(tag)}
                    className="rounded-lg bg-bg-inset px-2 py-0.5 text-xs text-text-muted transition-colors hover:bg-hover"
                  >
                    #{tag}
                  </Link>
                ))}
              </p>
            )}

            <div className="mt-2">
              {/* The same strip the notes carry: biggest zap on the left with what they wrote, most. */}
              <ZapStrip zaps={articleZaps.get(article.id) ?? []} noteId={article.id} />
              <InteractionBar event={article} counts={counts.get(article.id)} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** The profile avatar. */
/** The banner, walking the Blossom mirrors before it gives up. */
function ProfileBanner({ url }: { url: string }): React.ReactNode {
  const { src, fail, onLoad, exhausted } = useBlossomSrc(url, undefined, true)
  if (src === undefined || exhausted) {
    return <div className="h-28 w-full bg-gradient-to-br from-accent-subtle to-bg-inset" />
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host; next/image would need every relay's CDN allowlisted
    <img
      src={src}
      alt=""
      onError={fail}
      onLoad={onLoad}
      className="h-32 w-full bg-bg-inset object-cover sm:h-48"
    />
  )
}

function ProfileAvatar({
  pubkey,
  name,
  picture,
}: {
  pubkey: string
  name: string
  picture?: string
}): React.ReactNode {
  /* Walks the mirrors before falling back to an initial. */
  const { src, fail, onLoad, exhausted } = useBlossomSrc(picture, undefined, 384)
  const initial = name.trim().charAt(0).toUpperCase() || '?'

  if (src !== undefined && !exhausted) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
      <img
          src={src}
        alt=""
        onError={fail}
        onLoad={onLoad}
        className="size-24 rounded-full bg-bg-inset object-cover sm:size-32"
      />
    )
  }
  return (
    <span
      className="flex size-24 items-center justify-center rounded-full bg-bg-inset text-3xl font-bold text-text-muted sm:size-32 sm:text-4xl"
      title={pubkey}
    >
      {initial}
    </span>
  )
}

/** Zap. */
function ZapButton({ address, target }: { address: string; target: Hex }): React.ReactNode {
  const router = useRouter()
  const { session } = useSession()
  const signer = session.status === 'signed' ? session.signer : undefined
  const signedIn = sessionPubkey(session) !== undefined
  const [zapping, setZapping] = useState(false)

  return (
    <>
    <button
      type="button"
      onClick={() => {
        if (!signedIn || signer === undefined) router.push('/login')
        else setZapping(true)
      }}
      title={address !== '' ? `Zap ${address}` : 'Zap'}
      aria-label="Zap"
      // Same box AND same ink as Chat and the overflow menu.
      className="flex size-10 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
    >
      {/* The same bolt as every note's action row. */}
      <InteractionIcon name="zap" size={19} />
    </button>

    {zapping && signer !== undefined ? (
      <ZapDialog
        viewer={sessionPubkey(session)}
        recipient={target}
        signer={signer}
        onClose={() => setZapping(false)}
      />
    ) : null}
    </>
  )
}

/** Start a private conversation. */
function ChatButton({ target }: { target: string }): React.ReactNode {
  const router = useRouter()
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const signedIn = viewer !== undefined

  return (
    <button
      type="button"
      onClick={() => {
        if (!signedIn || viewer === undefined) {
          router.push('/login')
          return
        }
        /** Straight into the conversation with this person. */
        router.push(`/chat?c=${encodeURIComponent(conversationKeyOf([viewer, target]))}`)
      }}
      aria-label="Message"
      title="Message"
      className="flex size-10 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
    >
      <ChatBubbleIcon />
    </button>
  )
}

// ---------------------------------------------------------------------------.
/** A stand-in event for text that is not one. */
const EMPTY_EVENT = {
  id: '',
  pubkey: '',
  created_at: 0,
  kind: 0,
  tags: [] as string[][],
  content: '',
  sig: '',
} satisfies NostrEvent

// --------------------------------------------------------------------------- Tabs.

/** One array, so the hook's dependency does not change identity on every off-tab render. */
const EMPTY_NOTES: NostrEvent[] = []

type ProfileTabId = 'posts' | 'replies' | 'reposts' | 'articles' | 'media' | 'zaps'

/** Which count belongs on which tab, or none. */
/** `reads` is NOT here, and that is deliberate rather than an omission. */
const PROFILE_TABS: { id: ProfileTabId; label: string }[] = [
  { id: 'posts', label: 'Notes' },
  { id: 'replies', label: 'Replies' },
  { id: 'reposts', label: 'Reposts' },
  { id: 'media', label: 'Media' },
  { id: 'zaps', label: 'Zaps' },
]

const EMPTY_COPY: Record<ProfileTabId, string> = {
  posts: 'No posts from this account yet.',
  replies: 'No replies yet.',
  articles: 'No long-form articles yet.',
  media: 'No photos or videos yet.',
  reposts: 'Nothing reposted yet.',
  zaps: 'No zaps to show.',
}

/** Notes carrying an image or a video, which is what the Media tab is a view. */
function hasMedia(event: NostrEvent): boolean {
  for (const segment of parseContent(event.content, event.tags)) {
    if (segment.type === 'image' || segment.type === 'video') return true
  }
  return false
}

/** The house tab strip, and nothing else. */
function ProfileTabs({
  active,
  onChange,
}: {
  active: ProfileTabId
  onChange: (tab: ProfileTabId) => void
}): React.ReactNode {
  /** The strip, plus `reads` when that is where the reader. */
  const visibleTabs =
    active === 'articles'
      ? [...PROFILE_TABS, { id: 'articles' as const, label: 'Articles' }]
      : PROFILE_TABS

  return (
    <div className={TAB_STRIP}>
      <div role="tablist" aria-label="Profile sections" className={TAB_STRIP_ROW_TIGHT}>
        {visibleTabs.map(item => {
          const selected = active === item.id
          return (
            <button
              key={item.id}
              /* The panels below are still a bare ternary with no role="tabpanel", so there. */
              id={`profile-tab-${item.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              /* Roving tabindex: a tablist is ONE tab stop with arrows inside it, not five stops. */
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
              onKeyDown={event => {
                const key = event.key
                if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') {
                  return
                }
                /* Arrows move FOCUS. */
                event.preventDefault()
                const strip = event.currentTarget.parentElement
                if (strip === null) return
                const tabs = Array.from(strip.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
                const here = tabs.indexOf(event.currentTarget)
                const next =
                  key === 'Home'
                    ? 0
                    : key === 'End'
                      ? tabs.length - 1
                      : key === 'ArrowRight'
                        ? (here + 1) % tabs.length
                        : (here - 1 + tabs.length) % tabs.length
                const target = tabs[next]
                if (target === undefined) return
                // preventScroll, then a horizontal-only nudge: focusing an off-screen tab must scroll.
                target.focus({ preventScroll: true })
                target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
              }}
              /* `TAB_CELL_TIGHT` rather than `TAB_CELL`: five 7rem cells cannot fit a 390px phone. */
              className={`${TAB_CELL_TIGHT} focus-visible:-outline-offset-2 ${
                selected ? TAB_ACTIVE : `${TAB_IDLE} hover:text-text`
              }`}
            >
              {/* `TAB_LABEL` pins this box to the line height, which is what makes the marker land. */}
              <span className={TAB_LABEL}>
                {item.label}
                {selected ? (
                  <span aria-hidden="true" className={TAB_UNDERLINE} />
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The profile page with nothing in it yet: the shape, none of the facts. */
function ProfileShell(): React.ReactNode {
  return (
    <div>
      <header className="border-b border-border">
        <div className="h-28 w-full bg-gradient-to-br from-accent-subtle to-bg-inset" />
        <div className="px-4 pb-3 sm:px-5">
          <div className="-mt-10 mb-3 size-20 rounded-full border-4 border-bg bg-bg-inset sm:size-24" />
          <div className="h-5 w-40 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
          <div className="mt-2 h-3.5 w-28 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
          <div className="mt-4 h-3.5 w-56 animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none" />
        </div>
      </header>
      <ProfileNotesSkeleton />
    </div>
  )
}

function ProfileNotesSkeleton(): React.ReactNode {
  return (
    <div aria-hidden="true">
      {['85%', '62%', '78%', '55%', '90%', '68%', '74%', '58%'].map((width, row) => (
        <div key={row} className="flex gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="size-11 shrink-0 animate-pulse rounded-full bg-bg-inset motion-reduce:animate-none" />
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

/** Media as a grid, not a feed. */
function MediaGrid({ notes, loading }: { notes: NostrEvent[]; loading: boolean }): React.ReactNode {
  const items = useMemo(
    () =>
      notes.flatMap(note => {
        for (const segment of parseContent(note.content, note.tags)) {
          if (segment.type === 'image') return [{ note, url: segment.url, video: false }]
          if (segment.type === 'video') return [{ note, url: segment.url, video: true }]
        }
        return []
      }),
    [notes],
  )

  if (loading && items.length === 0) {
    return (
      <div className="grid grid-cols-3 gap-1 p-1" aria-hidden="true">
        {Array.from({ length: 9 }, (_, cell) => (
          <div
            key={cell}
            className="aspect-square animate-pulse rounded-sm bg-bg-inset motion-reduce:animate-none"
          />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-text-muted sm:px-5">{EMPTY_COPY.media}</p>
  }

  return (
    <div className="grid grid-cols-3 gap-1 p-1">
      {items.map(item => (
        <Link
          key={`${item.note.id}-${item.url}`}
          href={noteHref(item.note)}
          className="relative aspect-square overflow-hidden rounded-sm bg-bg-inset"
        >
          {item.video ? (
            <>
              {/* Poster-less: a <video> with no autoplay paints its first frame. */}
              <video
                src={item.url}
                muted
                playsInline
                preload="metadata"
                className="size-full object-cover"
              />
              <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white">
                <span className="material-symbols-outlined text-[14px]!" aria-hidden="true">
                  play_arrow
                </span>
              </span>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
            <img
              src={item.url}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="size-full object-cover transition-transform hover:scale-105"
            />
          )}
        </Link>
      ))}
    </div>
  )
}
