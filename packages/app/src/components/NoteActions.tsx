import { useState } from 'react'
import { Pressable, Text, useWindowDimensions, View } from 'react-native'
import type { NostrEvent } from '@nostrich/nostr'

import { makeStyles, useTheme } from '../theme'
import { ActionIcon, type IconName } from './icons'

/** Counts for one note, as far as the relays we read know. */
export interface NoteCounts {
  replies?: number
  zapSats?: number
  /** Distinct zaps. */
  zapCount?: number
  likes?: number
  /** All amplifications, quotes included. */
  reposts?: number
  /** The quote subset of `reposts`, for ranking's ×1 top-up. */
  quotes?: number
}

export interface NoteActionsProps {
  event: NostrEvent
  counts?: NoteCounts
  /** Actions the reader has already taken, so the icon can render filled. */
  liked?: boolean
  reposted?: boolean
  zapped?: boolean
  bookmarked?: boolean
  onReply?: () => void
  onLike?: () => void
  onRepost?: () => void
  onZap?: () => void
  onBookmark?: () => void
}

/** The reposted green, and the only colour on this row that is not a theme token. */
const REPOST_GREEN = '#00ba7c'

/** The like pink and the action blue. */
const LIKE_PINK = '#f91980'
const ACTION_BLUE = '#1d9bf0'

/** The circle that appears behind an icon on hover. */
const HOVER = {
  reply: '#1d9bf01a',
  repost: '#00ba7c1a',
  like: '#f915801a',
  // The zap orange at 20%.
  zap: '#e3641433',
  bookmark: '#1d9bf01a',
} as const

export function NoteActions({
  event,
  counts,
  liked = false,
  reposted = false,
  zapped = false,
  bookmarked = false,
  onReply,
  onLike,
  onRepost,
  onZap,
  onBookmark,
}: NoteActionsProps): React.ReactNode {
  const theme = useTheme()
  const s = styles(theme)
  void event

  /** A little larger on a phone. */
  const { width } = useWindowDimensions()
  const compact = width < 640

  return (
    <View style={s.row}>
      <Action
        compact={compact}
        icon="reply"
        label="Reply"
        count={counts?.replies}
        tint={ACTION_BLUE}
        hover={HOVER.reply}
        onPress={onReply}
      />
      <Action
        compact={compact}
        icon="repost"
        label="Repost"
        count={counts?.reposts}
        tint={REPOST_GREEN}
        hover={HOVER.repost}
        active={reposted}
        onPress={onRepost}
      />
      <Action
        compact={compact}
        icon="zap"
        label="Zap"
        count={counts?.zapSats}
        /* The bolt gets the bright gold, the amount gets the readable one. */
        tint={theme.zapIcon}
        countTint={theme.zapText}
        hover={HOVER.zap}
        active={zapped}
        onPress={onZap}
      />
      <Action
        compact={compact}
        icon="like"
        label="Like"
        count={counts?.likes}
        tint={LIKE_PINK}
        hover={HOVER.like}
        active={liked}
        onPress={onLike}
      />
      <Action
        compact={compact}
        icon="bookmark"
        label="Bookmark"
        /** Blue, where every other accent on this row is the app's purple. */
        tint={ACTION_BLUE}
        hover={HOVER.bookmark}
        active={bookmarked}
        onPress={onBookmark}
      />
    </View>
  )
}

function Action({
  icon,
  label,
  count,
  tint,
  countTint,
  hover,
  active = false,
  compact = false,
  onPress,
}: {
  icon: IconName
  label: string
  count?: number
  tint: string
  /** For the number, where it must stay legible even when the glyph is brighter. */
  countTint?: string
  /** The circle behind the icon on hover. */
  hover: string
  active?: boolean
  /** Phone-sized: a slightly larger glyph and circle. */
  compact?: boolean
  onPress?: () => void
}): React.ReactNode {
  const theme = useTheme()
  const s = styles(theme)
  /** `onHoverIn`/`onHoverOut` are react-native-web's, and are simply never called. */
  const [hovered, setHovered] = useState(false)

  /** HOVER TAKES THE COLOUR, and the glyph stays hollow. */
  const lit = active || hovered
  const color = lit ? tint : theme.textFaint
  const countColor = lit ? (countTint ?? tint) : theme.textFaint

  return (
    <Pressable
      accessibilityRole="button"
      // The count belongs in the label, not beside.
      accessibilityLabel={count !== undefined && count > 0 ? `${label}, ${count}` : label}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={10}
      style={s.action}
    >
      {/* The circle is its own fixed-size box so the row does not move when it appears. */}
      <View
        style={[s.halo, compact ? s.haloCompact : null, hovered ? { backgroundColor: hover } : null]}
      >
        <ActionIcon name={icon} color={color} filled={active} size={compact ? 20 : 18} />
      </View>
      {count !== undefined && count > 0 ? (
        <Text style={[s.count, { color: countColor }]}>{format(count)}</Text>
      ) : null}
    </Pressable>
  )
}

/** 1200 → 1.2k. Long numbers push the row's icons out of their even rhythm. */
function format(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

const styles = makeStyles((theme, t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Spread across the card's full width.
    justifyContent: 'space-between',
    marginTop: t.spacing[2],
    marginLeft: -t.spacing[1],
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    // Half the gap it used to be: the hover circle now supplies the rest, and at the old.
    gap: t.spacing[1],
    paddingVertical: t.spacing[1],
    paddingHorizontal: t.spacing[1],
  },
  /** 32px around an 18px icon. */
  halo: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    margin: -7,
  },
  /** 36 around 20, which is the same 8px ring at the larger size. */
  haloCompact: {
    width: 36,
    height: 36,
    borderRadius: 18,
    margin: -8,
  },
  /** 13/16, and tabular figures. */
  count: { fontSize: 13, lineHeight: 16, color: theme.textFaint, fontVariant: ['tabular-nums'] },
}))
