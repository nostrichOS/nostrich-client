'use client'

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  DEFAULT_DM_RELAYS,
  DEFAULT_RELAYS,
  buildDirectMessage,
  buildDmRelayList,
  conversationKeyOf,
  dmRelayListFilter,
  giftWrapFilter,
  groupConversations,
  isFileMessage,
  normalizeRelayUrls,
  parseDmRelayList,
  routeWraps,
  unwrapDirectMessage,
  type Conversation,
  type DecryptedDirectMessage,
  type DmRelayList,
  type Hex,
  type NostrEvent,
  type RelayUrl,
  type Signer,
} from '@nostrich/nostr'

import { firstLookAt } from './first-look'
import { activeScope, readScoped, writeScoped } from './scope'
import { getPool } from './pool'

/** Private messages (NIP-17), for the whole session. */

/** Wraps queued for opening. Past this, the oldest are dropped rather than the newest. */
const MAX_QUEUE = 1_500
/** Wraps opened. */
const CONCURRENCY = 4
/** Consecutive failures before we stop claiming this is an empty inbox. */
const STALL_THRESHOLD = 25

/** Legacy direct messages (NIP-04, kind 4). */
const LEGACY_KIND = 4

/** Per direction. */
const LEGACY_LIMIT = 500

interface ChatState {
  /** Decrypted messages by rumor id. */
  messages: Map<string, DecryptedDirectMessage>
  /** Relay lists for everyone we might message, so sends can be routed. */
  relayLists: Map<Hex, DmRelayList>
  loading: boolean
  /** Whether a sync has ever been started for this session. */
  started: boolean
  /** Wraps seen but not yet opened. */
  pending: number
  /** True when we looked, found no kind-10050, and could not publish one either. */
  missingOwnRelayList: boolean
  /** A long run of failed unwraps. */
  signerStalled: boolean
  /** The signer cannot decrypt NIP-04 at all. */
  legacyUnavailable: boolean
}

const state: ChatState = {
  messages: new Map(),
  relayLists: new Map(),
  loading: false,
  started: false,
  pending: 0,
  missingOwnRelayList: false,
  signerStalled: false,
  legacyUnavailable: false,
}

const listeners = new Set<() => void>()
/** Bumped on every change. */
let version = 0

function emit(): void {
  version += 1
  for (const listener of listeners) listener()
}

function subscribeStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// --------------------------------------------------------------------------- Read.

const READ_KEY = 'nostrich:chat-read'

/** Which conversations have been read, and up. */
function parseMarkers(raw: string | null): Record<string, number> | undefined {
  if (raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

let markerScope: string | undefined
let markers: Record<string, number> = {}

/** Load this account's markers, if they are not already loaded. */
function ensureScope(): void {
  const scope = activeScope()
  if (scope === markerScope) return
  markerScope = scope
  markers = parseMarkers(readScoped(READ_KEY)) ?? {}
}

function persistMarkers(): void {
  writeScoped(READ_KEY, JSON.stringify(markers))
}

/** Notified when a marker MOVES, which is a different event from a message arriving. */
const markerListeners = new Set<() => void>()

export function onChatMarkersChange(listener: () => void): () => void {
  markerListeners.add(listener)
  return () => markerListeners.delete(listener)
}

function markersMoved(): void {
  for (const listener of markerListeners) listener()
}

export function chatMarkers(): Readonly<Record<string, number>> {
  ensureScope()
  return markers
}

/** Merge markers published by this account's other devices. */
export function adoptChatMarkers(remote: Readonly<Record<string, number>>): void {
  ensureScope()
  let changed = false
  const merged = { ...markers }
  for (const [key, at] of Object.entries(remote)) {
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) continue
    if ((merged[key] ?? 0) >= at) continue
    merged[key] = at
    changed = true
  }
  if (!changed) return
  markers = merged
  persistMarkers()
  emit()
}

export function markConversationRead(key: string, at: number): void {
  ensureScope()
  if ((markers[key] ?? 0) >= at) return
  markers = { ...markers, [key]: at }
  persistMarkers()
  emit()
  markersMoved()
}

// --------------------------------------------------------------------------- Syncing.

let syncing: { pubkey: Hex; stop: () => void } | undefined

type Envelope = { legacy: false; event: NostrEvent } | { legacy: true; event: NostrEvent }
const queue: Envelope[] = []
let active = 0
let consecutiveFailures = 0
let seenWraps = new Set<string>()

function pump(signer: Signer): void {
  while (active < CONCURRENCY && queue.length > 0) {
    const next = queue.shift()
    if (next === undefined) break
    active += 1
    state.pending = queue.length + active
    const open = next.legacy ? openLegacy(signer, next.event) : unwrapDirectMessage(signer, next.event)
    void open
      .then(message => {
        if (message === null) {
          consecutiveFailures += 1
          if (consecutiveFailures >= STALL_THRESHOLD && !state.signerStalled) {
            state.signerStalled = true
          }
          return
        }
        consecutiveFailures = 0
        state.signerStalled = false
        // Keyed by rumor id, so the sender's own copy and the recipient's copy of the same.
        state.messages.set(message.id, message)
      })
      .catch(() => {
        consecutiveFailures += 1
      })
      .finally(() => {
        active -= 1
        state.pending = queue.length + active
        if (queue.length === 0 && active === 0) state.loading = false
        emit()
        pump(signer)
      })
  }
  if (queue.length === 0 && active === 0) state.loading = false
  emit()
}

/** /** A kind-4 as a DirectMessage, or null. */
async function openLegacy(signer: Signer, event: NostrEvent): Promise<DecryptedDirectMessage | null> {
  const decrypt = signer.nip04Decrypt
  if (decrypt === undefined) {
    state.legacyUnavailable = true
    return null
  }

  const self = await signer.getPublicKey()
  const recipients = event.tags.filter((tag: string[]) => tag[0] === 'p').map((tag: string[]) => tag[1])
  const peer = event.pubkey === self ? recipients.find(value => value !== undefined) : event.pubkey
  if (peer === undefined || peer.length !== 64) return null

  try {
    const content = await decrypt.call(signer, peer, event.content)
    if (content === '') return null
    return {
      id: event.id,
      senderPubkey: event.pubkey,
      participants: [event.pubkey, peer === event.pubkey ? self : peer].sort(),
      content,
      createdAt: event.created_at,
      // Legacy messages have no wrap.
      wrapId: event.id,
    }
  } catch {
    // Not ours, or a ciphertext this signer cannot open.
    return null
  }
}

/** How long the kind-10050 lookup waits. */
const DM_LIST_TIMEOUT_MS = 10_000

/** The newest parseable kind-10050 in a result set, or null. */
function newestDmList(events: readonly NostrEvent[]): DmRelayList | null {
  let newest: DmRelayList | null = null
  for (const event of events) {
    const parsed = parseDmRelayList(event)
    if (parsed === null) continue
    if (newest === null || parsed.updatedAt > newest.updatedAt) newest = parsed
  }
  return newest
}

/** Where our own gift wraps are delivered. */
export async function ownDmRelays(pubkey: Hex): Promise<RelayUrl[]> {
  const outcome = await getPool().queryWithStatus(
    [dmRelayListFilter([pubkey])],
    undefined,
    DM_LIST_TIMEOUT_MS,
  )
  const newest = newestDmList(outcome.events)
  if (newest !== null && newest.relays.length > 0) {
    state.missingOwnRelayList = false
    state.relayLists.set(pubkey, newest)
    emit()
    return newest.relays
  }
  /* Only a list the network actually DENIED having is missing. */
  state.missingOwnRelayList = outcome.answered > 0
  emit()
  // Subscribe to the DM defaults meanwhile, so the inbox is not blank.
  return normalizeRelayUrls([...DEFAULT_DM_RELAYS])
}

/** Create a kind-10050 for this account, but only if it truly has none. */
export async function ensureDmRelayList(signer: Signer, pubkey: Hex): Promise<void> {
  const outcome = await getPool().queryWithStatus(
    [dmRelayListFilter([pubkey])],
    undefined,
    DM_LIST_TIMEOUT_MS,
  )
  if (outcome.answered === 0) return

  const newest = newestDmList(outcome.events)
  if (newest !== null && newest.relays.length > 0) {
    state.relayLists.set(pubkey, newest)
    state.missingOwnRelayList = false
    emit()
    return
  }
  const published = await publishDmRelayList(signer, pubkey)
  state.missingOwnRelayList = !published
  emit()
}

export function startChatSync(signer: Signer, pubkey: Hex): void {
  if (syncing?.pubkey === pubkey) return
  stopChatSync()

  state.loading = true
  state.started = true
  state.signerStalled = false
  consecutiveFailures = 0
  seenWraps = new Set()
  emit()

  let closed = false
  let handle: { close: () => void } | undefined

  const enqueue = (event: NostrEvent, legacy: boolean): void => {
    if (seenWraps.has(event.id)) return
    seenWraps.add(event.id)
    queue.push(legacy ? { legacy: true, event } : { legacy: false, event })
    // Newest first: the conversations someone opens the app to read are the recent ones.
    queue.sort((a, b) => b.event.created_at - a.event.created_at)
    if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE
    pump(signer)
  }

  void ownDmRelays(pubkey).then(relays => {
    if (closed) return
    /** TWO SUBSCRIPTIONS, because the two protocols live in different places. */
    const wraps = getPool().subscribe({
      // The inbox is open for the whole session and is how a message arrives.
      live: true,
      filters: [giftWrapFilter(pubkey)],
      relays,
      onEvent: event => enqueue(event, false),
      onEose: () => {
        if (queue.length === 0 && active === 0) {
          state.loading = false
          emit()
        }
      },
    })

    /* Kind-4 predates kind-10050 by years and lives wherever the sender happened. */
    const legacy = getPool().subscribe({
      live: true,
      filters: [
        { kinds: [LEGACY_KIND], '#p': [pubkey], limit: LEGACY_LIMIT },
        { kinds: [LEGACY_KIND], authors: [pubkey], limit: LEGACY_LIMIT },
      ],
      relays: [...new Set([...relays, ...normalizeRelayUrls([...DEFAULT_RELAYS])])],
      onEvent: event => enqueue(event, true),
    })

    handle = {
      close: () => {
        wraps.close()
        legacy.close()
      },
    }
  })

  syncing = {
    pubkey,
    stop: () => {
      closed = true
      handle?.close()
    },
  }
}

export function stopChatSync(): void {
  syncing?.stop()
  syncing = undefined
  queue.length = 0
  active = 0
  // Plaintext does not outlive the session it was decrypted in, and signing out ends.
  state.messages = new Map()
  state.relayLists = new Map()
  state.pending = 0
  state.loading = false
  emit()
}

// --------------------------------------------------------------------------- Sending.

async function fetchRelayLists(pubkeys: Hex[]): Promise<Map<Hex, DmRelayList>> {
  const missing = pubkeys.filter(pubkey => !state.relayLists.has(pubkey))
  if (missing.length > 0) {
    const events = await getPool().query([dmRelayListFilter(missing)], undefined, 6_000)
    for (const event of events) {
      const parsed = parseDmRelayList(event)
      if (parsed === null) continue
      const held = state.relayLists.get(parsed.pubkey)
      if (held === undefined || parsed.updatedAt > held.updatedAt) {
        state.relayLists.set(parsed.pubkey, parsed)
      }
    }
    emit()
  }
  return state.relayLists
}

export interface SendResult {
  /** At least one participant's wrap reached at least one relay. */
  ok: boolean
  /** Participants with no kind-10050. NIP-17 forbids falling back to their other relays. */
  undeliverable: Hex[]
  /** Participants whose wrap was refused by EVERY relay they nominated. */
  unreachable: Hex[]
}

export async function sendChatMessage(
  signer: Signer,
  participants: Hex[],
  content: string,
): Promise<SendResult> {
  const { message, wraps } = await buildDirectMessage(signer, participants, content)
  const lists = await fetchRelayLists(participants)
  const { deliveries, undeliverable: unrouted } = routeWraps(wraps, lists)
  /* The sender is one of the wraps and is not a participant to warn. */
  const undeliverable = unrouted.filter(pubkey => pubkey !== message.senderPubkey)

  /* PER RECIPIENT, because that is the unit that either arrives or does. */
  /* BEFORE PUBLISHING, tell our own push server this wrap is ours. */
  /* From `wraps`, NOT from `deliveries`. */
  const ownWraps = wraps
    .filter(wrap => wrap.recipient === message.senderPubkey)
    .map(wrap => wrap.wrap.id)

  const results = await Promise.all(
    deliveries.map(async delivery => ({
      recipient: delivery.recipient,
      ok: (await getPool().publish(delivery.wrap, delivery.relays)).some(result => result.ok),
    })),
  )
  // The sender's own copy is one of these wraps and is not a participant to warn.
  const unreachable = results
    .filter(result => !result.ok && result.recipient !== message.senderPubkey)
    .map(result => result.recipient)
  const ok = results.some(result => result.ok)

  if (ok) {
    // Local echo.
    state.messages.set(message.id, message)
    markers = { ...markers, [conversationKeyOf(message.participants)]: message.createdAt }
    persistMarkers()
    emit()
    markersMoved()
  }
  return { ok, undeliverable, unreachable }
}

/** Publish a kind-10050 so other clients know where to send. */
/** Publish a kind-10050. `relays` is what the reader chose, when a reader chose. */
export async function publishDmRelayList(
  signer: Signer,
  pubkey: Hex,
  relays?: readonly RelayUrl[],
): Promise<boolean> {
  try {
    // The DM set, not the read set.
    const event = await buildDmRelayList(
      signer,
      normalizeRelayUrls(relays ?? [...DEFAULT_DM_RELAYS]),
    )
    const results = await getPool().publish(event)
    if (!results.some(result => result.ok)) return false
    const parsed = parseDmRelayList(event)
    if (parsed !== null) state.relayLists.set(pubkey, parsed)
    state.missingOwnRelayList = false
    emit()
    return true
  } catch {
    return false
  }
}

// --------------------------------------------------------------------------- Hooks.

function getSnapshot(): number {
  return version
}

function getServerSnapshot(): number {
  return 0
}

export interface ConversationPreview {
  text: string
  /** Prefixes the row with "You:". */
  fromSelf: boolean
}

export interface ChatView {
  conversations: Conversation[]
  messagesByConversation: Map<string, DecryptedDirectMessage[]>
  previews: Map<string, ConversationPreview>
  loading: boolean
  /** False until a sync has been started at all. */
  started: boolean
  pending: number
  missingOwnRelayList: boolean
  signerStalled: boolean
  /** Older NIP-04 conversations exist but this signer cannot decrypt them. */
  legacyUnavailable: boolean
  totalUnread: number
}

export function useChat(self: Hex | undefined): ChatView {
  useSyncExternalStore(subscribeStore, getSnapshot, getServerSnapshot)
  ensureScope()

  return useMemo(() => {
    const all = [...state.messages.values()]
    const conversations = groupConversations(all, {
      self,
      lastReadAt: markers,
      // See `floorAt` in dm.ts: an absent marker means this device does not know.
      floorAt: firstLookAt(self),
    })

    const messagesByConversation = new Map<string, DecryptedDirectMessage[]>()
    for (const message of all) {
      const key = conversationKeyOf(message.participants)
      const list = messagesByConversation.get(key) ?? []
      list.push(message)
      messagesByConversation.set(key, list)
    }
    // Oldest first within a conversation: a transcript reads down the page.
    for (const list of messagesByConversation.values()) {
      list.sort((a, b) => a.createdAt - b.createdAt)
    }

    const previews = new Map<string, ConversationPreview>()
    for (const [key, list] of messagesByConversation) {
      const last = list[list.length - 1]
      if (last === undefined) continue
      previews.set(key, {
        // A file message's content is a URL, which is not a preview of anything.
        text: isFileMessage(last) ? 'Sent an attachment' : last.content,
        fromSelf: last.senderPubkey === self,
      })
    }

    return {
      conversations,
      messagesByConversation,
      previews,
      loading: state.loading,
      started: state.started,
      pending: state.pending,
      missingOwnRelayList: state.missingOwnRelayList,
      signerStalled: state.signerStalled,
      legacyUnavailable: state.legacyUnavailable,
      totalUnread: conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    }
    // `version` is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [self, version])
}

/** Keeps the session's sync running for as long as a signed-in screen is mounted. */
export function useChatSync(signer: Signer | undefined, pubkey: Hex | undefined): void {
  useEffect(() => {
    if (signer === undefined || pubkey === undefined) {
      stopChatSync()
      return
    }
    // Also here, not only in `useChat`: the sync runs app-wide while the chat screen may.
    ensureScope()
    startChatSync(signer, pubkey)
    // Deliberately NOT stopped on unmount: navigating away from /chat and back would.
  }, [signer, pubkey])
}

export function useMarkRead(): (key: string, at: number) => void {
  return useCallback((key: string, at: number) => markConversationRead(key, at), [])
}

/** The other party in a 1:1 conversation, or undefined for a group. */
export function counterpart(conversation: Conversation, self: Hex | undefined): Hex | undefined {
  const others = conversation.participants.filter(pubkey => pubkey !== self)
  return others.length === 1 ? others[0] : undefined
}
