/** What we ask a remote signer for at pairing time. */

/** Event kinds this app asks the reader's own key to sign. */
const SIGNED_KINDS = [
  0, // profile edit, ProfileEditor
  1, // notes and replies, Composer, ReplyComposer, MediaLightbox
  /** NIP-22 comment, signed when answering a comment. */
  1111,
  3, // follow / unfollow, FollowButton.
  5, // deletion, undoing a like or removing a note, lib/note-actions.ts
  6, // repost, lib/note-actions.ts
  7, // reaction, lib/note-actions.ts
  13, // NIP-17 seal.
  16, // generic repost, for reposting anything that is not a kind-1
  1984, // report, ProfileMenu
  9734, // zap request.
  /** NIP-51 mute list. */
  10000,
  10001, // pinned notes, lib/pinned.ts
  10002, // relay list (NIP-65)
  10003, // bookmarks, lib/bookmarks.ts
  10050, // DM relay list (NIP-17), published when chat is first used
  24242, // Blossom upload auth.
  /** NIP-98 HTTP auth. */
  27235,
  /** NIP-78 app data. */
  30078,
  30023, // long-form articles, ArticleEditor publishes these.
] as const

/** Kinds deliberately NOT requested, so nobody adds them speculatively: - **1059**. */

/** Encryption capabilities. */
const CAPABILITIES = [
  'nip44_encrypt', // sending DMs, and sealing private bookmarks
  'nip44_decrypt', // reading DMs, and reading private bookmarks
  'nip04_decrypt', // legacy kind-4 history, read-only
] as const

/** The `perms` argument for a NIP-46 `connect`. */
export const SIGNER_PERMS: string[] = [
  ...SIGNED_KINDS.map(kind => `sign_event:${kind}`),
  ...CAPABILITIES,
]
