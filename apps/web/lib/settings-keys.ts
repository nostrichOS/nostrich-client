import { THEME_STORAGE_KEY } from '@nostrich/ui'

/** Every preference that belongs to an account, in one list. */

export const FONT_KEY = 'nostrich.fontSize'
export const BADGE_KEY = 'nostrich:badge'
export const GROUPING_KEY = 'nostrich:group-notifications'
/** Replies in a thread you were only p-tagged. */
export const THREAD_MENTIONS_KEY = 'nostrich:thread-mentions'
export const BOOKMARKS_PUBLIC_KEY = 'nostrich.bookmarks.public'
export const ZAP_AMOUNT_KEY = 'nostrich:zap-amount'
export const ZAP_PRESETS_KEY = 'nostrich:zap-presets'
export const NEWS_LANGUAGE_KEY = 'nostrich:news-language'
export const CUSTOM_FEEDS_KEY = 'nostrich:feeds'
/** The adult-content switch. */
export const HIDE_NSFW_KEY = 'nostrich:hide-nsfw'
/** The deck's columns. */
/** What the reader decided about a message request. */
export const CHAT_ACCEPTED_KEY = 'nostrich:chat-accepted'
export const CHAT_DELETED_KEY = 'nostrich:chat-deleted'

/** The read markers. */
export const NOTIFICATIONS_SEEN_KEY = 'nostrich:notifications-seen'
export const ZAPS_SEEN_KEY = 'nostrich:zaps-seen'

export interface SyncedSetting {
  /** Stable name on the wire. Never rename one. */
  id: string
  /** The localStorage base key, scoped per account by lib/scope. */
  base: string
}

export const SYNCED_SETTINGS: readonly SyncedSetting[] = [
  { id: 'fontSize', base: FONT_KEY },
  { id: 'badge', base: BADGE_KEY },
  { id: 'notificationGrouping', base: GROUPING_KEY },
  { id: 'threadMentions', base: THREAD_MENTIONS_KEY },
  { id: 'bookmarksPublic', base: BOOKMARKS_PUBLIC_KEY },
  { id: 'zapAmount', base: ZAP_AMOUNT_KEY },
  { id: 'zapPresets', base: ZAP_PRESETS_KEY },
  { id: 'newsLanguage', base: NEWS_LANGUAGE_KEY },
  { id: 'customFeeds', base: CUSTOM_FEEDS_KEY },
  { id: 'hideNsfw', base: HIDE_NSFW_KEY },
  /** What the reader decided about a message request. */
  { id: 'chatAccepted', base: CHAT_ACCEPTED_KEY },
  { id: 'chatDeleted', base: CHAT_DELETED_KEY },
]

/** The bases, for the change listener that decides whether a write is worth publishing. */
export const SYNCED_BASES: ReadonlySet<string> = new Set(SYNCED_SETTINGS.map(entry => entry.base))
