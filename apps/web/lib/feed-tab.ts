/** The feed tab vocabulary, and the rule that decides which one a reader lands. */

export type FeedTabId = 'follows' | 'latest' | 'trending' | 'custom'

export function tabFromParam(raw: string | null): FeedTabId | null {
  switch (raw) {
    case 'follows':
    // The first release spelled it "following".
    case 'following':
      return 'follows'
    case 'trending':
      return 'trending'
    case 'custom':
      return 'custom'
    case 'latest':
    // `verified`, `discover` and `global` all shipped at some point.
    case 'verified':
    case 'discover':
    case 'global':
      return 'latest'
    default:
      return null
  }
}

/** Which feed a reader lands. */
export function resolveTab({
  requested,
  signedIn,
  customMissing,
  hasFollows,
}: {
  /** The `feed` URL parameter, already normalised. */
  requested: FeedTabId | null
  signedIn: boolean
  /** A `custom` route naming a feed this device does. */
  customMissing: boolean
  /** Whether the reader has a contact list. */
  hasFollows: boolean
}): FeedTabId {
  /** Where a reader lands when they have not asked for anywhere in particular. */
  const fallback: FeedTabId = hasFollows ? 'latest' : 'trending'

  /* An EXPLICIT request always wins, including a signed-out reader asking for Latest. */
  if (requested === 'custom') return customMissing ? fallback : 'custom'
  if (requested === 'follows' && !signedIn) return fallback
  if (requested !== null) return requested
  return signedIn && hasFollows ? 'follows' : fallback
}

