import { memo } from 'react'
import { Image, Text, View } from 'react-native'
import {
  profileDisplayName,
  profileHandle,
  type NostrEvent,
} from '@nostrich/nostr'

import { Link } from '../nav'
import { makeStyles, useTheme } from '../theme'
import { NoteActions, type NoteCounts } from './NoteActions'
import { NoteContent } from './NoteContent'
import { VerifiedBadge } from './VerifiedBadge'

/** One note, on every platform: avatar, header, body, actions. */

export interface NoteCardProps {
  event: NostrEvent
  /** Profile for the author, when the caller already resolved. */
  profile?: {
    name?: string
    displayName?: string
    picture?: string
    nip05?: string
    lud16?: string
    lud06?: string
  } | null
  /** True only when the nip05 claim resolved back to this same pubkey. */
  verified?: boolean
  /** Relative time, already formatted by the caller (locale lives in the app shell). */
  timeLabel: string
  /** Put the handle and timestamp on a SECOND line, under the display name. */
  stackedHeader?: boolean
  npub: string
  noteHref: string
  profileHref: string
  /** Link builders for entities inside the body. */
  profileHrefFor: (pubkeyHex: string, bech32: string) => string
  eventHrefFor: (idHex: string, bech32: string) => string
  hashtagHrefFor: (tag: string) => string
  /** Where an `naddr` points, and what it is called. */
  addressHrefFor?: (bech32: string) => string
  /** Pointers the host draws as a card instead of inline. */
  hideAddresses?: readonly string[]
  addressTitleFor?: (segment: { kind: number; pubkey: string; identifier: string }) => string | undefined
  /** Engagement tallies, as far as the reader's relay set knows. */
  counts?: NoteCounts
  /** Action state and handlers, forwarded straight to the action row. */
  liked?: boolean
  reposted?: boolean
  zapped?: boolean
  bookmarked?: boolean
  /** Rendered under the body AND under the media: a quoted note or a link preview. */
  quote?: React.ReactNode
  /** Rendered between the body and the media. */
  beforeMedia?: React.ReactNode
  /** Event references already shown as `quote`, so the body does not repeat them as links. */
  hideEventIds?: readonly string[]
  /** Links drawn as a preview card by the host. */
  hideUrls?: readonly string[]
  /** Resolves a mentioned pubkey to a display name. */
  nameFor?: (pubkeyHex: string) => string | undefined
  /** Draws a video player for a URL. */
  renderVideo?: (url: string, opts?: { railHeight?: number }) => React.ReactNode
  /** Same escape hatch as `renderVideo`: web hands down a real audio player. */
  renderAudio?: (url: string) => React.ReactNode
  /** See `NoteContent`. */
  isAudioOnly?: (url: string) => boolean
  /** A payable lightning invoice, supplied by the host. */
  renderInvoice?: (bolt11: string) => React.ReactNode
  /** Rendered between the header and the body. */
  beforeContent?: React.ReactNode
  /** Drop the card's own bottom border, because something below it will draw the divider. */
  hideDivider?: boolean
  /** Draw the whole body, with no "Show more". */
  unfolded?: boolean
  /** The author's avatar, supplied by the host. */
  renderAvatar?: () => React.ReactNode
  /** The action row, when the host has a better one than this package can build. */
  renderActions?: () => React.ReactNode
  /** True when this note's author is the reader, so their own badge colour applies. */
  badgeMine?: boolean
  /** Reserves space at the right of the header row for a menu the HOST draws. */
  headerGutter?: boolean
  onReply?: () => void
  onLike?: () => void
  onRepost?: () => void
  onZap?: () => void
  onBookmark?: () => void
  /** Media tapped. Host decides what a full-screen viewer looks like on its platform. */
  onOpenMedia?: (url: string) => void
}

function NoteCardImpl({
  event,
  profile,
  verified = false,
  timeLabel,
  stackedHeader = false,
  npub,
  noteHref,
  profileHref,
  profileHrefFor,
  eventHrefFor,
  hashtagHrefFor,
  addressHrefFor,
  addressTitleFor,
  hideAddresses,
  counts,
  liked,
  reposted,
  zapped,
  bookmarked,
  quote,
  beforeMedia,
  hideEventIds,
  hideUrls,
  nameFor,
  renderActions,
  renderVideo,
  renderAudio,
  isAudioOnly,
  renderInvoice,
  beforeContent,
  hideDivider,
  unfolded,
  renderAvatar,
  badgeMine,
  headerGutter,
  onReply,
  onLike,
  onRepost,
  onZap,
  onBookmark,
  onOpenMedia,
}: NoteCardProps): React.ReactNode {
  const theme = useTheme()
  const s = styles(theme)
  const name = profileDisplayName({ ...profile, pubkey: event.pubkey })
  const initial = name.trim().charAt(0).toUpperCase() || '?'

  /** Display name, then @username. */
  const handle = profileHandle(profile) ?? npub.slice(5, 13)

  return (
    <View style={hideDivider === true ? [s.card, s.cardNoDivider] : s.card}>
      {renderAvatar === undefined ? (
        <Link href={profileHref} accessibilityLabel={`Profile of ${name}`}>
          {profile?.picture !== undefined && profile.picture !== '' ? (
            <Image source={{ uri: profile.picture }} style={s.avatar} accessibilityIgnoresInvertColors />
          ) : (
            // Deterministic fallback rather than a shared placeholder image: an avatar.
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarInitial}>{initial}</Text>
            </View>
          )}
        </Link>
      ) : (
        renderAvatar()
      )}

      <View style={s.body}>
        <View style={stackedHeader ? s.headerStack : s.headerRow}>
          <View style={stackedHeader ? s.headerLineOne : s.headerInline}>
          {/* Wrapped in a View because `Link` takes no style, and this cell is what allows. */}
          <View style={s.nameCell}>
            {/* The clamp has to land on the ANCHOR, not only on the cell around. */}
            <Link href={profileHref} className="block min-w-0 max-w-full truncate">
              <Text style={s.name} numberOfLines={1}>
                {name}
              </Text>
            </Link>
          </View>

          {/* 17, up from the 15 default, so the tick keeps its proportion to a 16px name. */}
          {verified ? <VerifiedBadge mine={badgeMine} size={17} /> : null}
          </View>

          <View style={stackedHeader ? s.headerLineTwo : s.headerInline}>
          <Text style={s.handle} numberOfLines={1}>
            @{handle}
          </Text>

          {/* The separator and the timestamp travel together and never shrink. */}
          <View style={s.metaCell}>
            <Text style={s.dot}>·</Text>
            <Link href={noteHref} accessibilityLabel="Open thread">
              <Text style={s.time}>{timeLabel}</Text>
            </Link>
          </View>
          </View>

          {headerGutter === true ? <View style={s.headerGutter} /> : null}
        </View>

        <View style={s.content}>
          {beforeContent}
          <NoteContent
            event={event}
            profileHref={profileHrefFor}
            eventHref={eventHrefFor}
            hashtagHref={hashtagHrefFor}
            addressHref={addressHrefFor}
            addressTitle={addressTitleFor}
            hideAddresses={hideAddresses}
            onOpenMedia={onOpenMedia}
            hideEventIds={hideEventIds}
            hideUrls={hideUrls}
            nameFor={nameFor}
            renderVideo={renderVideo}
            renderAudio={renderAudio}
            {...(isAudioOnly === undefined ? {} : { isAudioOnly })}
            renderInvoice={renderInvoice}
            beforeMedia={beforeMedia}
            {...(unfolded === true ? { unfolded: true } : {})}
          />
        </View>

        {/* A quoted note, supplied by the host because fetching it needs a relay pool. */}
        {quote}

        {renderActions === undefined ? (
          <NoteActions
            event={event}
            counts={counts}
            liked={liked}
            reposted={reposted}
            zapped={zapped}
            bookmarked={bookmarked}
            onReply={onReply}
            onLike={onLike}
            onRepost={onRepost}
            onZap={onZap}
            onBookmark={onBookmark}
          />
        ) : (
          renderActions()
        )}
      </View>
    </View>
  )
}

const styles = makeStyles((theme, t) => ({
  card: {
    flexDirection: 'row',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    // 14/12 vertical rather than a symmetric 12: the action row already carries its own.
    paddingTop: t.spacing[3],
    paddingBottom: t.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  /** See `hideDivider`: the separator is drawn by whatever wraps the note instead. */
  cardNoDivider: { borderBottomWidth: 0 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.bgInset,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: theme.textMuted, fontWeight: '700', fontSize: 17 },
  // minWidth 0 is what lets a long unbroken token wrap instead of stretching the row.
  body: { flex: 1, minWidth: 0, flexShrink: 1 },
  /** Empty space the host's ⋯ button sits over, so a long name does not run beneath. */
  headerGutter: {
    width: 28,
    flexShrink: 0,
  },
  /** The name's cell: the first thing to give up room when the row is too narrow. */
  nameCell: { flexShrink: 1, minWidth: 0, overflow: 'hidden' },
  /** The dot and the timestamp, as one unit that keeps its width whatever else gives way. */
  metaCell: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[1], flexShrink: 0 },
  /** ONE LINE, and the long parts are cut short rather than wrapped. */
  /** Name on one line, handle and time on the next. */
  headerStack: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    marginBottom: t.spacing[1],
  },
  /** A group that stays inline whichever mode the header. */
  /** `flexShrink: 1` ON THE GROUPS, not only on the cells inside them. */
  headerInline: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: t.spacing[1],
    minWidth: 0,
    flexShrink: 1,
  },
  headerLineOne: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: t.spacing[1],
    minWidth: 0,
    maxWidth: '100%',
    flexShrink: 1,
  },
  headerLineTwo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: t.spacing[1],
    minWidth: 0,
    maxWidth: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    // `gap` is what fixes "Trey✓" running together.
    gap: t.spacing[1],
    marginBottom: t.spacing[1],
  },
  /** The header row: X's STRUCTURE, one point larger than X's number. */
  name: { fontWeight: '700', color: theme.text, fontSize: 16 },
  // The handle gives up room too, after the name.
  handle: { color: theme.textMuted, fontSize: 16, flexShrink: 1, minWidth: 0 },
  // The date and the separator never shrink: they are four characters that say.
  dot: { color: theme.textFaint, fontSize: 16, flexShrink: 0 },
  time: { color: theme.textFaint, fontSize: 16, flexShrink: 0 },
  content: { marginTop: t.spacing[1] },
}))

/** Memoised on the event, whose identity is stable across feed flushes. */
export const NoteCard = memo(NoteCardImpl)

