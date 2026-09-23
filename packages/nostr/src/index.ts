/** Public surface of @nostrich/nostr. */

export type {
  BlobDescriptor,
  ContentSegment,
  Conversation,
  DirectMessage,
  EventTemplate,
  Filter,
  Hex,
  Nip05Status,
  NostrEvent,
  Pool,
  Profile,
  PublishResult,
  QueryOutcome,
  RelayList,
  RelayPolicy,
  RelayStatus,
  RelayUrl,
  Signer,
  SubscribeParams,
  SubscriptionHandle,
  ThreadContext,
  UploadResult,
  WalletConnection,
  ZapReceipt,
  ZapTarget,
} from './types'

export * from './client-tag'
export * from './keys'
export * from './nip49'
export * from './signers'
export * from './pool'
export * from './events'
export * from './fetch-event'
export * from './moved-hosts'
export * from './video-embed'
export * from './text'
export * from './thread'
export * from './bookmarks'
export { isCiphertext, isSealed } from './ciphertext'
export * from './content'
export * from './profile'
export * from './dm'
export * from './zap'
export * from './nutzap'
export * from './nwc'

export {
  DEFAULT_INDEXER_RELAYS,
  DEFAULT_RELAYS,
  DEFAULT_DM_RELAYS,
  DEFAULT_SIGNER_RELAYS,
  signerRelays,
  MAX_FILTERS_PER_REQ,
  RELAY_LIST_KIND,
  SEARCH_RELAYS,
  ZAP_RELAYS,
  buildRelayListEvent,
  buildRelayListTags,
  defaultRelayEntries,
  inboxRelaysForAuthor,
  isPrivateHostname,
  isPrivateUrl,
  isRelayUrl,
  normalizeRelayUrl,
  normalizeRelayUrls,
  parseRelayList,
  parseRelayTags,
  publishRelays,
  readRelaysForAuthor,
  relayUrlsEqual,
  selectOutboxRelays,
  tryNormalizeRelayUrl,
} from './relays'
export { BODY_LIMIT, truncateSegments } from './content'
export { DEFAULT_RELAY_ENTRIES } from './relays'
export type { OutboxOptions, OutboxSelection, RelayEntry, RelayPickOptions } from './relays'

export {
  clearNip05Cache,
  formatNip05,
  isNip05Identifier,
  nip05Url,
  parseNip05,
  peekNip05,
  resolveNip05,
  verifyNip05,
} from './nip05'
export type { Nip05Identifier, Nip05Options, Nip05Resolution } from './nip05'

export {
  BLOSSOM_AUTH_KIND,
  BlossomError,
  DEFAULT_BLOSSOM_SERVERS,
  MEDIA_PRESET_RATIO,
  blobSha256,
  blobUrl,
  blossomAlternatives,
  blossomAuthHeader,
  blossomOperator,
  buildImetaTag,
  createBlossomAuth,
  galleryPreset,
  imetaDimFor,
  imetaThumbFor,
  mediaPreset,
  deleteBlob,
  listBlobs,
  mirrorBlob,
  normalizeServer,
  uploadBlob,
  uploadServers,
  uploadWithMirrors,
} from './blossom'
export type { MediaPreset } from './blossom'
export { createHttpAuth, httpAuthHeader, NIP98_KIND } from './http-auth'
export type { HttpAuthParams } from './http-auth'
export { powBits } from './events'
export {
  EMPTY_MUTES,
  MAX_MUTES,
  MUTE_LIST_KIND,
  buildMuteList,
  hasMute,
  mergeMutes,
  muteKey,
  muteKeys,
  mutedPubkeys,
  newestMuteList,
  parseMuteList,
  parseMuteTags,
  parsePrivateMutes,
  privateMutesPlaintext,
  toMuteTags,
  toggleMute,
} from './mute-list'
export type { MuteEntry, MuteList, MuteType } from './mute-list'
export {
  BURST_LIMIT,
  BURST_WINDOW_SECONDS,
  MAX_HASHTAGS,
  MAX_REPLY_PTAGS,
  MAX_ROOT_PTAGS,
  SPAMMER_HASHTAGS,
  burstRate,
  distinctHashtags,
  distinctMentions,
  isBursting,
  isHellthread,
  isGreetingOnly,
  isRootNote,
  isTagStuffed,
  spokenWords,
  isTagStuffingAccount,
} from './spam-shape'
export {
  advertisesCampaignDomain,
  bodySignature,
  hasAdultName,
  hasSuppressedName,
  isAdultName,
  isBlockedFromDiscovery,
  isExcludedFromTrending,
  isPromotable,
  isPromotableTag,
  isSuppressed,
  isSuppressedName,
  linksToPhishingDomain,
} from './spam-rules'
export { advertisedHosts, manipulatedEngagement, selfPromotingReply } from './abuse'
export { engagementScore } from './engagement'
export type { EngagementCounts } from './engagement'
export type { ObservedCounts, Manipulation } from './abuse'
export type {
  BlobInput,
  BlossomAuthParams,
  BlossomRequestOptions,
  BlossomVerb,
  ImetaExtras,
  ListOptions,
  UploadOptions,
} from './blossom'

export {
  isDemoted,
  noteHostFailure,
  noteHostSuccess,
  reorderByHealth,
  resetHostHealth,
} from './host-health'

/** What this app asks a remote signer. */
export { SIGNER_PERMS } from './signer-perms'

/** Signature verification, passed through from nostr-tools. */
export { verifyEvent } from 'nostr-tools/pure'

export { addressLabel, type AddressLike } from './address-label'

export {
  LIVE_EVENT_KIND,
  isLiveEvent,
  liveEventAt,
  parseLiveEvent,
  type LiveEvent,
  type LiveStatus,
} from './live-event'

export {
  MIN_ROOT_NOTES,
  MIN_REPLIES,
  MIN_FOLLOWING,
  authoredCounts,
  countsAreUsable,
  followingCount,
  isThinAccount,
  newestContacts,
  type AccountEvidence,
  type AuthoredCounts,
} from './thin-account'

export { DELETED_PROFILE_NAME, buildDeletedProfile } from './delete-account'

export {
  EDIT_KIND,
  applyEdit,
  editApplies,
  editTarget,
  newestEdit,
} from './edited'
