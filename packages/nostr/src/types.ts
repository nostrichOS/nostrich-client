/** Core protocol contracts for Nostrich. */

import type { Event as NostrToolsEvent, EventTemplate as NostrToolsTemplate } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'

export type { Filter }

/** A signed, verified Nostr event. */
export type NostrEvent = NostrToolsEvent

/** An unsigned event, ready to hand to a Signer. */
export type EventTemplate = NostrToolsTemplate

/** Lowercase hex, 64 chars. */
export type Hex = string

/** A relay URL, normalised (wss://, no trailing slash). */
export type RelayUrl = string

// --------------------------------------------------------------------------- Signing.

/** The ONLY way this codebase touches a private key. */
export interface Signer {
  /** Hex pubkey of the identity being signed. */
  getPublicKey(): Promise<Hex>
  /** Fill in pubkey/id/sig. Must not mutate the template. */
  signEvent(template: EventTemplate): Promise<NostrEvent>
  /** NIP-44 v2 conversation-key encryption. */
  nip44Encrypt(peerPubkey: Hex, plaintext: string): Promise<string>
  nip44Decrypt(peerPubkey: Hex, ciphertext: string): Promise<string>
  /** NIP-04 legacy DM crypto. */
  nip04Decrypt?(peerPubkey: Hex, ciphertext: string): Promise<string>
  /** Human-readable label for the settings screen, e.g. */
  readonly kind: 'privatekey' | 'nip07' | 'nip46'
}

// --------------------------------------------------------------------------- Relays.

export type RelayPolicy = { read: boolean; write: boolean }

/** A user's NIP-65 relay list (kind 10002), plus where we learned. */
export interface RelayList {
  entries: Array<{ url: RelayUrl; policy: RelayPolicy }>
  updatedAt: number
}

export interface RelayStatus {
  url: RelayUrl
  state: 'connecting' | 'open' | 'closed' | 'failed'
  /** Last error message, for the relay screen in Settings. */
  error?: string
  /** Round-trip of the most recent successful REQ, in ms. */
  latencyMs?: number
}

export interface SubscriptionHandle {
  /** Idempotent. Safe to call after EOSE or after the pool has closed. */
  close(): void
}

export interface SubscribeParams {
  filters: Filter[]
  /** Defaults to the pool's configured read relays. */
  relays?: RelayUrl[]
  onEvent(event: NostrEvent, relay: RelayUrl): void
  /** Fires once, when every relay has sent EOSE (or timed out). */
  onEose?(): void
  /** Fires per relay, and ONLY for a real EOSE frame. */
  onRelayEose?(relay: RelayUrl): void
  /** Close the subscription as soon as onEose fires. */
  closeOnEose?: boolean
  /** A subscription that must never wait behind other work. */
  live?: boolean
}

/** Per-call overrides for a query. */
/** How much a caller cares about a relay that accepts a COUNT frame and never replies. */
export interface CountOptions {
  /** Skip relays that have recently taken a COUNT and not replied. */
  skipUnresponsive?: boolean
}

export interface QueryOptions {
  /** Quiet time, after at least one relay has answered, before resolving without the rest. */
  graceMs?: number
  /** Called for each event AS IT ARRIVES, before the query settles. */
  onEvent?: (event: NostrEvent) => void
}

/** What `queryWithStatus` resolves: the events, and how the request actually went. */
export interface QueryOutcome {
  events: NostrEvent[]
  /** Relays that sent a genuine EOSE. */
  answered: number
  /** Relays the request was aimed. */
  attempted: number
}

export interface PublishResult {
  relay: RelayUrl
  ok: boolean
  /** Relay's OK message reason on failure, e.g. */
  message?: string
}

/** Connection manager over a set of relays. */
export interface Pool {
  subscribe(params: SubscribeParams): SubscriptionHandle
  /** Open sockets to these relays ahead of time. */
  warm(relays: readonly RelayUrl[]): Promise<void>
  /** Resolves when every targeted relay has accepted or rejected. */
  publish(event: NostrEvent, relays?: RelayUrl[]): Promise<PublishResult[]>
  /** Publish, resolving true the moment ONE relay accepts. */
  publishFirstAccept(event: NostrEvent, relays?: RelayUrl[]): Promise<boolean>
  /** NIP-45 COUNT. */
  count(
    filters: Filter[],
    relays?: RelayUrl[],
    timeoutMs?: number,
    options?: CountOptions,
  ): Promise<number | undefined>
  /** One-shot query. Collects until EOSE, then resolves. */
  query(
    filters: Filter[],
    relays?: RelayUrl[],
    timeoutMs?: number,
    options?: QueryOptions,
  ): Promise<NostrEvent[]>
  /** The same query, plus whether anyone answered. */
  queryWithStatus(
    filters: Filter[],
    relays?: RelayUrl[],
    timeoutMs?: number,
    options?: QueryOptions,
  ): Promise<QueryOutcome>
  status(): RelayStatus[]
  /** The read relays this pool is currently configured. */
  readRelays(): RelayUrl[]
  setRelays(relays: Array<{ url: RelayUrl; policy: RelayPolicy }>): void
  close(): void
}

// ---------------------------------------------------------------------------.

/** Parsed kind-0 metadata. */
export interface Profile {
  pubkey: Hex
  name?: string
  displayName?: string
  about?: string
  picture?: string
  banner?: string
  /** NIP-05 identifier as claimed by the user. */
  nip05?: string
  /** Lightning address (LUD-16) or LNURL (LUD-06), for zaps. */
  lud16?: string
  lud06?: string
  website?: string
  /** created_at of the kind-0 we parsed, for last-write-wins across relays. */
  updatedAt: number
}

/** Result of resolving a claimed NIP-05 back to a pubkey. */
export interface Nip05Status {
  identifier: string
  verified: boolean
  checkedAt: number
  relays?: RelayUrl[]
}

// --------------------------------------------------------------------------- Content.

/** A parsed segment of note content, ready to render on any platform. */
export type ContentSegment =
  | { type: 'text'; value: string }
  | { type: 'url'; url: string }
  | { type: 'image'; url: string }
  | { type: 'video'; url: string }
  /** A sound file, rendered as a player rather than as a link. */
  | { type: 'audio'; url: string }
  | { type: 'hashtag'; tag: string }
  /** A NIP-30 custom emoji: `:wisp_eyes:` plus an `emoji` tag naming the image. */
  | { type: 'emoji'; shortcode: string; url: string }
  /** `relays` is what an `nprofile` says about where to find this person. */
  | { type: 'mention'; pubkey: Hex; bech32: string; relays?: readonly RelayUrl[] }
  /** `author` is the pubkey an `nevent` names, and it is the difference between a quote. */
  | { type: 'event'; id: Hex; bech32: string; relays?: RelayUrl[]; author?: Hex }
  | {
      type: 'address'
      kind: number
      pubkey: Hex
      identifier: string
      bech32: string
      /** Relay hints from the naddr's own TLV. */
      relays?: RelayUrl[]
    }
  | { type: 'invoice'; bolt11: string }
  | { type: 'cashu'; token: string }

/** NIP-10 thread position of a reply. */
export interface ThreadContext {
  /** Root of the thread. Absent on a top-level note. */
  rootId?: Hex
  /** The note being directly replied. */
  replyToId?: Hex
  /** Pubkeys to carry into the reply's p-tags so everyone stays notified. */
  mentionedPubkeys: Hex[]
}

// --------------------------------------------------------------------------- Direct.

/** A decrypted private message. */
export interface DirectMessage {
  /** id of the inner rumor. Stable across recipients. */
  id: Hex
  senderPubkey: Hex
  /** All participants including the sender, sorted, for group conversations. */
  participants: Hex[]
  content: string
  createdAt: number
  /** Set when the message replies to another within the conversation. */
  replyToId?: Hex
  /** id of the outer kind-1059, needed to delete our local copy. */
  wrapId: Hex
}

/** A conversation is keyed by its sorted participant set, not by a thread id. */
export interface Conversation {
  /** Sorted participant pubkeys joined by ':'. */
  key: string
  participants: Hex[]
  lastMessageAt: number
  unreadCount: number
}

// --------------------------------------------------------------------------- Zaps.

export interface ZapTarget {
  /** Who gets paid. */
  recipientPubkey: Hex
  /** Note being zapped. Omit to zap a profile directly. */
  eventId?: Hex
  amountMsat: number
  comment?: string
  /** Relays where the recipient should look for the receipt. */
  relays: RelayUrl[]
}

/** A verified kind-9735 zap receipt, already checked against the recipient's LNURL. */
export interface ZapReceipt {
  id: Hex
  /** Who paid. Taken from the embedded zap request, NOT the receipt's own pubkey. */
  senderPubkey: Hex
  recipientPubkey: Hex
  eventId?: Hex
  amountMsat: number
  comment?: string
  createdAt: number
  bolt11: string
  /** Whether `senderPubkey` is PROVEN rather than asserted. */
  senderVerified: boolean
  /** Whether the RECIPIENT'S OWN LNURL SERVER signed this receipt. */
  issuerVerified: boolean
}

/** NIP-47 Nostr Wallet Connect. Parsed from a nostr+walletconnect:// URI. */
export interface WalletConnection {
  walletPubkey: Hex
  relay: RelayUrl
  /** Hex secret used to sign requests to the wallet. */
  secret: Hex
  lud16?: string
}

// --------------------------------------------------------------------------- Media.

/** A blob on a Blossom server. */
export interface BlobDescriptor {
  sha256: Hex
  url: string
  size: number
  type?: string
  uploaded: number
}

export interface UploadResult {
  sha256: Hex
  /** Every server that accepted the blob, primary first. */
  urls: string[]
  size: number
  type?: string
  /** Servers that rejected it, with the reason. */
  failures: Array<{ server: string; error: string }>
}
