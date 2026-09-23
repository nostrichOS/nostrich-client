/** Icon geometry, shared by the web and native renderers. */

export type IconName = 'reply' | 'zap' | 'like' | 'repost' | 'bookmark'

export const PATHS: Record<IconName, string> = {
  /* Speech bubble: a horizontal pill with a short tail hooking down-left. */
  reply:
    'M21.4 10.46A6.66 6.66 0 0 0 14.74 3.8H9.26a6.66 6.66 0 0 0 0 13.33H14c-.05 1.17-.3 2.07-.8 2.77 1.2.33 8.2-2.9 8.2-9.44z',
  // Lightning bolt: one closed zig, no waist.
  zap: 'M13 2 3 14h8l-1 8 10-12h-8l1-8z',
  // Heart, lobes meeting low.
  like: 'M20.6 5a5.2 5.2 0 0 0-7.4 0L12 6.2 10.8 5A5.2 5.2 0 1 0 3.4 12.4l8.6 8.5 8.6-8.5A5.2 5.2 0 0 0 20.6 5z',
  // Two arrows looping.
  repost: 'M17 2.5 21 6l-4 3.5M3 12V9a3 3 0 0 1 3-3h15M7 21.5 3 18l4-3.5M21 12v3a3 3 0 0 1-3 3H3',
  // Bookmark ribbon.
  bookmark: 'M19 21.5 12 16.6 5 21.5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
}

/** The stroke every one of them is drawn. */
export const STROKE = 1.8

/** NIP-05 verified badge. Single evenodd path: starburst filled, tick knocked out. */
export const BADGE_PATH =
  'M8.50941 0L9.53314 1.94972L11.759 2.29179L11.4059 4.4533L13 6.00021L11.4061 7.54734L11.7585 9.7082L9.53201 10.0503L8.50838 12L6.4994 11.0066L4.49194 11.9996L3.46887 10.0502L1.24134 9.70816L1.59414 7.5473L0 6.00038L1.59392 4.45325L1.24147 2.29239L3.46783 1.94984L4.49111 0.000754215L6.49943 0.993864L8.50941 0ZM4.11667 5.72772L3.25 6.60044L5.41667 8.78226L9.75 4.41863L8.88333 3.5459L5.41667 7.03681L4.11667 5.72772Z'

/** Which icons are a CLOSED shape, and can therefore be filled once the action is taken. */
export const FILLABLE: Record<IconName, boolean> = {
  reply: false,
  repost: false,
  zap: true,
  like: true,
  bookmark: true,
}
