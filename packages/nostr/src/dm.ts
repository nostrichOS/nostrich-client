/** NIP-17 private direct messages. */

import { finalizeEvent, generateSecretKey, getEventHash, verifyEvent } from 'nostr-tools/pure'
import { encrypt as nip44Encrypt, getConversationKey } from 'nostr-tools/nip44'
import {
  DirectMessageRelaysList,
  FileMessage,
  GiftWrap,
  PrivateDirectMessage,
  Seal,
} from 'nostr-tools/kinds'

import { isSealed } from './ciphertext'
import type {
  Conversation,
  DirectMessage,
  Filter,
  Hex,
  NostrEvent,
  RelayUrl,
  Signer,
} from './types'

/** Ceiling on how far seal and wrap timestamps are pushed into the past, per NIP-17. */
export const MAX_WRAP_JITTER_SECONDS = 2 * 24 * 60 * 60

const HEX_64 = /^[0-9a-f]{64}$/
const HEX_128 = /^[0-9a-f]{128}$/

/** The unsigned inner event. It is never signed and never published on its own. */
export interface Rumor {
  id: Hex
  pubkey: Hex
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

/** Metadata for a kind-15 file message. */
export interface FileAttachment {
  mimeType: string
  /** NIP-17 defines aes-gcm today. */
  algorithm: string
  key: string
  nonce: string
  /** sha256 of the ENCRYPTED bytes as served. */
  sha256?: string
  /** sha256 of the plaintext file, only verifiable after decrypting. */
  originalSha256?: string
  size?: number
  /** "<width>x<height>", so the UI can reserve layout space before the download finishes. */
  dim?: string
  blurhash?: string
}

export interface FileDirectMessage extends DirectMessage {
  file: FileAttachment
}

export type DecryptedDirectMessage = DirectMessage | FileDirectMessage

export function isFileMessage(message: DecryptedDirectMessage): message is FileDirectMessage {
  return 'file' in message
}

export interface GiftWrapDelivery {
  /** The participant this wrap decrypts. */
  recipient: Hex
  wrap: NostrEvent
}

export interface BuiltDirectMessage {
  /** The message as its recipients will read it, for optimistic local echo. */
  message: DecryptedDirectMessage
  /** One wrap per participant, the sender's own copy included. */
  wraps: GiftWrapDelivery[]
}

export interface DirectMessageOptions {
  /** Makes this a kind-15 file message, in which case `content` is the file URL. */
  file?: FileAttachment
  /** NIP-17 subject line. Mostly used to name group conversations. */
  subject?: string
  /** Participant pubkey -> a relay where they can be reached, copied into the p-tags. */
  relayHints?: Readonly<Record<Hex, RelayUrl>>
}

/** Build the gift wraps for one message. */
export async function buildDirectMessage(
  signer: Signer,
  participants: Hex[],
  content: string,
  replyToId?: Hex,
  options: DirectMessageOptions = {},
): Promise<BuiltDirectMessage> {
  const self = assertHexPubkey(await signer.getPublicKey(), 'signer pubkey')
  const everyone = sortedParticipants([...participants, self])
  if (replyToId !== undefined && !HEX_64.test(replyToId)) {
    throw new Error(`replyToId must be lowercase hex, got ${JSON.stringify(replyToId)}`)
  }

  const tags: string[][] = []
  for (const pubkey of everyone) {
    // p-tags carry the receivers only.
    if (pubkey === self) continue
    const hint = options.relayHints?.[pubkey]
    tags.push(hint === undefined ? ['p', pubkey] : ['p', pubkey, hint])
  }
  if (replyToId !== undefined) tags.push(['e', replyToId, '', 'reply'])
  if (options.subject !== undefined) tags.push(['subject', options.subject])
  if (options.file !== undefined) tags.push(...fileTags(options.file))

  const sentAt = Math.floor(Date.now() / 1000)
  const draft = {
    pubkey: self,
    created_at: sentAt,
    kind: options.file === undefined ? PrivateDirectMessage : FileMessage,
    tags,
    content,
  }
  // One rumor for the whole conversation, sealed N times.
  const rumor: Rumor = { ...draft, id: getEventHash(draft) }
  const serialisedRumor = JSON.stringify(rumor)

  const wraps: GiftWrapDelivery[] = []
  let selfWrapId = ''
  for (const recipient of everyone) {
    /* THE SEAL IS CHECKED BEFORE IT IS SIGNED. */
    const sealed = await signer.nip44Encrypt(recipient, serialisedRumor)
    if (!isSealed(sealed, serialisedRumor)) {
      throw new Error(
        'signer did not encrypt the message: refusing to publish a seal that would be readable',
      )
    }
    const seal = await signer.signEvent({
      kind: Seal,
      content: sealed,
      // Backdated per NIP-59. Only the rumor keeps the honest clock.
      created_at: backdated(sentAt),
      tags: [],
    })
    const wrap = giftWrap(seal, recipient, sentAt, options.relayHints?.[recipient])
    if (recipient === self) selfWrapId = wrap.id
    wraps.push({ recipient, wrap })
  }

  const message: DirectMessage = {
    id: rumor.id,
    senderPubkey: self,
    participants: everyone,
    content,
    createdAt: rumor.created_at,
    // The sender holds one wrap per recipient, but only the self-addressed copy.
    wrapId: selfWrapId,
  }
  if (replyToId !== undefined) message.replyToId = replyToId

  return {
    message: options.file === undefined ? message : { ...message, file: options.file },
    wraps,
  }
}

/** Decrypt one kind-1059 into the message it hides, or null if it is not ours. */
export async function unwrapDirectMessage(
  signer: Signer,
  wrap: NostrEvent,
): Promise<DecryptedDirectMessage | null> {
  if (wrap.kind !== GiftWrap) return null

  const sealJson = await decryptOrNull(signer, wrap.pubkey, wrap.content)
  if (sealJson === null) return null
  const seal = parseSeal(sealJson)
  if (seal === null) return null
  // Decryption alone only proves someone holding the shared secret wrote.
  if (!verifyEvent(seal)) return null

  const rumorJson = await decryptOrNull(signer, seal.pubkey, seal.content)
  if (rumorJson === null) return null
  const rumor = parseRumor(rumorJson)
  if (rumor === null) return null

  // Nothing binds the rumor's declared author to the seal except this line.
  if (rumor.pubkey !== seal.pubkey) return null

  // A gift wrap can carry any event.
  if (rumor.kind !== PrivateDirectMessage && rumor.kind !== FileMessage) return null

  const message: DirectMessage = {
    id: rumor.id,
    senderPubkey: rumor.pubkey,
    // The sender is added back here because the rumor's p-tags list receivers only.
    participants: sortedParticipants([rumor.pubkey, ...pubkeysFromTags(rumor.tags)]),
    content: rumor.content,
    createdAt: rumor.created_at,
    wrapId: wrap.id,
  }
  const replyToId = replyTarget(rumor.tags)
  if (replyToId !== undefined) message.replyToId = replyToId

  if (rumor.kind === FileMessage) {
    const file = parseFileTags(rumor.tags)
    // Without the decryption tags a kind 15 is an opaque URL.
    if (file === null) return null
    return { ...message, file }
  }
  return message
}

/** The conversation's identity: its participant set, not a thread id. */
export function conversationKeyOf(participants: Hex[]): string {
  return sortedParticipants(participants).join(':')
}

export interface ConversationGroupingOptions {
  /** Our own pubkey. Messages we sent are never unread. */
  self?: Hex
  /** Conversation key -> created_at of the newest message the user has already seen. */
  lastReadAt?: Readonly<Record<string, number>>
  /** Nothing older than this counts as unread, whatever the markers say. */
  floorAt?: number
}

/** Fold decrypted messages into the conversation list, newest conversation first. */
export function groupConversations(
  messages: readonly DirectMessage[],
  options: ConversationGroupingOptions = {},
): Conversation[] {
  const byKey = new Map<string, Conversation>()
  for (const message of messages) {
    const key = conversationKeyOf(message.participants)
    let conversation = byKey.get(key)
    if (conversation === undefined) {
      conversation = {
        key,
        participants: sortedParticipants(message.participants),
        lastMessageAt: 0,
        unreadCount: 0,
      }
      byKey.set(key, conversation)
    }
    if (message.createdAt > conversation.lastMessageAt) conversation.lastMessageAt = message.createdAt
    const readThrough = Math.max(options.lastReadAt?.[key] ?? 0, options.floorAt ?? 0)
    if (message.createdAt > readThrough && message.senderPubkey !== options.self) {
      conversation.unreadCount += 1
    }
  }
  return [...byKey.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
}

/** Kind 10050: the relays where a user wants their DMs delivered. */
export interface DmRelayList {
  pubkey: Hex
  relays: RelayUrl[]
  updatedAt: number
}

export function parseDmRelayList(event: NostrEvent): DmRelayList | null {
  if (event.kind !== DirectMessageRelaysList) return null
  const relays: RelayUrl[] = []
  for (const tag of event.tags) {
    if (tag[0] !== 'relay') continue
    const url = normaliseRelayUrl(tag[1])
    if (url !== null && !relays.includes(url)) relays.push(url)
  }
  return { pubkey: event.pubkey, relays, updatedAt: event.created_at }
}

export async function buildDmRelayList(signer: Signer, relays: RelayUrl[]): Promise<NostrEvent> {
  const tags: string[][] = []
  for (const relay of relays) {
    const url = normaliseRelayUrl(relay)
    if (url === null) throw new Error(`not a relay URL: ${JSON.stringify(relay)}`)
    if (!tags.some((tag) => tag[1] === url)) tags.push(['relay', url])
  }
  // An empty kind 10050 reads as "this user cannot receive DMs" and silently drops.
  if (tags.length === 0) throw new Error('a DM relay list needs at least one relay')
  return signer.signEvent({
    kind: DirectMessageRelaysList,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })
}

export interface WrapDelivery extends GiftWrapDelivery {
  relays: RelayUrl[]
}

/** Decide where each wrap goes. */
export function routeWraps(
  wraps: readonly GiftWrapDelivery[],
  relayLists: ReadonlyMap<Hex, DmRelayList>,
): { deliveries: WrapDelivery[]; undeliverable: Hex[] } {
  const deliveries: WrapDelivery[] = []
  const undeliverable: Hex[] = []
  for (const { recipient, wrap } of wraps) {
    const relays = relayLists.get(recipient)?.relays ?? []
    if (relays.length === 0) undeliverable.push(recipient)
    else deliveries.push({ recipient, wrap, relays })
  }
  return { deliveries, undeliverable }
}

/** Subscription for our own incoming DMs. */
export function giftWrapFilter(recipient: Hex, since?: number): Filter {
  const filter: Filter = {
    kinds: [GiftWrap],
    '#p': [assertHexPubkey(recipient, 'recipient')],
  }
  if (since !== undefined) filter.since = Math.max(0, since - MAX_WRAP_JITTER_SECONDS)
  return filter
}

export function dmRelayListFilter(pubkeys: Hex[]): Filter {
  return {
    kinds: [DirectMessageRelaysList],
    authors: pubkeys.map((pubkey) => assertHexPubkey(pubkey, 'author')),
  }
}

// ---------------------------------------------------------------------------.

function giftWrap(
  seal: NostrEvent,
  recipient: Hex,
  sentAt: number,
  relayHint?: RelayUrl,
): NostrEvent {
  // A fresh key per recipient.
  const throwaway = generateSecretKey()
  return finalizeEvent(
    {
      kind: GiftWrap,
      content: nip44Encrypt(JSON.stringify(seal), getConversationKey(throwaway, recipient)),
      created_at: backdated(sentAt),
      tags: [relayHint === undefined ? ['p', recipient] : ['p', recipient, relayHint]],
    },
    throwaway,
  )
}

/** `sentAt` is the rumor's timestamp rather than a fresh clock read, so a decoy can. */
function backdated(sentAt: number): number {
  return sentAt - (1 + randomBelow(MAX_WRAP_JITTER_SECONDS))
}

function randomBelow(bound: number): number {
  // Math.random() is a linear PRNG whose internal state is recoverable from a handful.
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return (buffer[0] ?? 0) % bound
}

async function decryptOrNull(signer: Signer, peer: Hex, ciphertext: string): Promise<string | null> {
  try {
    return await signer.nip44Decrypt(peer, ciphertext)
  } catch {
    return null
  }
}

interface EventFields {
  pubkey: Hex
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

function parseSeal(json: string): NostrEvent | null {
  const raw = parseObject(json)
  if (raw === null) return null
  const base = eventFields(raw)
  if (base === null || base.kind !== Seal) return null
  const { id, sig } = raw
  if (typeof id !== 'string' || !HEX_64.test(id)) return null
  if (typeof sig !== 'string' || !HEX_128.test(sig)) return null
  return { ...base, id, sig }
}

function parseRumor(json: string): Rumor | null {
  const raw = parseObject(json)
  if (raw === null) return null
  // NIP-17 says a kind 14 MUST NOT be signed.
  if ('sig' in raw) return null
  const base = eventFields(raw)
  if (base === null) return null
  const computed = getEventHash(base)
  // Recompute instead of trusting: `id` is what the local store dedupes and deletes.
  if (typeof raw.id === 'string' && raw.id !== computed) return null
  return { ...base, id: computed }
}

function eventFields(raw: Record<string, unknown>): EventFields | null {
  const { pubkey, created_at, kind, content } = raw
  if (typeof pubkey !== 'string' || !HEX_64.test(pubkey)) return null
  if (typeof created_at !== 'number' || !Number.isInteger(created_at)) return null
  if (typeof kind !== 'number' || !Number.isInteger(kind)) return null
  if (typeof content !== 'string') return null
  const tags = stringMatrix(raw.tags)
  if (tags === null) return null
  return { pubkey, created_at, kind, tags, content }
}

function parseObject(json: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

function stringMatrix(value: unknown): string[][] | null {
  if (!Array.isArray(value)) return null
  const matrix: string[][] = []
  for (const entry of value) {
    if (!Array.isArray(entry)) return null
    const row: string[] = []
    for (const item of entry) {
      if (typeof item !== 'string') return null
      row.push(item)
    }
    matrix.push(row)
  }
  return matrix
}

function sortedParticipants(pubkeys: readonly Hex[]): Hex[] {
  const unique = new Set<Hex>()
  for (const pubkey of pubkeys) unique.add(assertHexPubkey(pubkey, 'participant'))
  return [...unique].sort()
}

function assertHexPubkey(value: string, label: string): Hex {
  // An npub that gets this far is tagged verbatim and addressed to nobody: relays match.
  if (!HEX_64.test(value)) {
    throw new Error(`${label} must be lowercase hex, got ${JSON.stringify(value)}`)
  }
  return value
}

function pubkeysFromTags(tags: readonly string[][]): Hex[] {
  const found: Hex[] = []
  for (const tag of tags) {
    const [name, value] = tag
    if (name !== 'p' || value === undefined || !HEX_64.test(value)) continue
    found.push(value)
  }
  return found
}

function replyTarget(tags: readonly string[][]): Hex | undefined {
  let firstEventTag: Hex | undefined
  for (const tag of tags) {
    if (tag[0] !== 'e') continue
    const id = tag[1]
    if (id === undefined || !HEX_64.test(id)) continue
    // A marked tag wins, but plenty of clients still send a bare e-tag, and inside a DM.
    if (tag[3] === 'reply') return id
    firstEventTag ??= id
  }
  return firstEventTag
}

function tagValue(tags: readonly string[][], name: string): string | undefined {
  for (const tag of tags) {
    if (tag[0] === name && tag[1] !== undefined) return tag[1]
  }
  return undefined
}

function fileTags(file: FileAttachment): string[][] {
  const tags: string[][] = [
    ['file-type', file.mimeType],
    ['encryption-algorithm', file.algorithm],
    ['decryption-key', file.key],
    ['decryption-nonce', file.nonce],
  ]
  if (file.sha256 !== undefined) tags.push(['x', file.sha256])
  if (file.originalSha256 !== undefined) tags.push(['ox', file.originalSha256])
  if (file.size !== undefined) tags.push(['size', String(file.size)])
  if (file.dim !== undefined) tags.push(['dim', file.dim])
  if (file.blurhash !== undefined) tags.push(['blurhash', file.blurhash])
  return tags
}

function parseFileTags(tags: readonly string[][]): FileAttachment | null {
  const mimeType = tagValue(tags, 'file-type')
  const algorithm = tagValue(tags, 'encryption-algorithm')
  const key = tagValue(tags, 'decryption-key')
  const nonce = tagValue(tags, 'decryption-nonce')
  if (mimeType === undefined || algorithm === undefined) return null
  if (key === undefined || nonce === undefined) return null

  const file: FileAttachment = { mimeType, algorithm, key, nonce }
  const sha256 = tagValue(tags, 'x')
  if (sha256 !== undefined) file.sha256 = sha256
  const originalSha256 = tagValue(tags, 'ox')
  if (originalSha256 !== undefined) file.originalSha256 = originalSha256
  const size = Number(tagValue(tags, 'size'))
  if (Number.isFinite(size) && size > 0) file.size = size
  const dim = tagValue(tags, 'dim')
  if (dim !== undefined) file.dim = dim
  const blurhash = tagValue(tags, 'blurhash')
  if (blurhash !== undefined) file.blurhash = blurhash
  return file
}

function normaliseRelayUrl(value: string | undefined): RelayUrl | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  // Only enough normalisation to dedupe tags and keep a bare host out of the list.
  if (!/^wss?:\/\/\S+$/i.test(trimmed)) return null
  return trimmed.replace(/\/+$/, '')
}
