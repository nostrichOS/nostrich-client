/** Threading: NIP-10, and now NIP-22 as well. */

import { referencesFromContent } from './content'
import {
  buildShortNote,
  eventAddress,
  getReferencedPubkeys,
  getTags,
  isAddressable,
  KINDS,
  normalizeHex,
  nowSeconds,
  parseAddress,
  type BuildOptions,
  type Tagged,
} from './events'
import { tryNormalizeRelayUrl } from './relays'
import type { EventTemplate, Hex, NostrEvent, RelayUrl, ThreadContext } from './types'

export type ThreadMarker = 'root' | 'reply' | 'mention'

export interface EventRef {
  id: Hex
  relay?: RelayUrl
  marker?: ThreadMarker
  /** 5th element of a marked e-tag: who wrote the referenced event, when the client. */
  author?: Hex
}

function isMarker(value: string | undefined): value is ThreadMarker {
  return value === 'root' || value === 'reply' || value === 'mention'
}

/** Every well-formed `e` tag, in document order. */
export function parseEventRefs(source: Tagged): EventRef[] {
  const refs: EventRef[] = []
  for (const tag of source.tags) {
    if (tag[0] !== 'e') continue
    const id = normalizeHex(tag[1])
    if (id === undefined) continue
    const ref: EventRef = { id }
    const relay = tag[2] === undefined || tag[2] === '' ? undefined : tryNormalizeRelayUrl(tag[2])
    if (relay !== undefined) ref.relay = relay
    if (isMarker(tag[3])) ref.marker = tag[3]
    const author = normalizeHex(tag[4])
    if (author !== undefined) ref.author = author
    refs.push(ref)
  }
  return refs
}

/** Where this event sits in its thread. */
export function parseThread(source: Tagged): ThreadContext {
  const refs = parseEventRefs(source)
  const context: ThreadContext = { mentionedPubkeys: getReferencedPubkeys(source) }

  /* NIP-22 first, because it is unambiguous where NIP-10 has to be inferred. */
  const comment = commentScope(source)
  if (comment !== undefined) {
    const root = comment.rootId ?? comment.parentId
    if (root !== undefined) context.rootId = root
    if (comment.parentId !== undefined) context.replyToId = comment.parentId
    return context
  }

  // A note that only *quotes* another carries ["e", id, "", "mention"] and is still.
  const marked = refs.some(ref => ref.marker !== undefined)
  if (marked) {
    const root = refs.find(ref => ref.marker === 'root')
    const replies = refs.filter(ref => ref.marker === 'reply')
    let reply = replies[replies.length - 1]
    if (reply === undefined) {
      // Some clients mark the root and leave the parent unmarked.
      const unmarked = refs.filter(ref => ref.marker === undefined)
      reply = unmarked[unmarked.length - 1]
    }
    if (root !== undefined) context.rootId = root.id
    // Only a "reply" marker means the root was never stated.
    else if (reply !== undefined) context.rootId = reply.id
    if (reply !== undefined) context.replyToId = reply.id
    else if (root !== undefined) context.replyToId = root.id
    return context
  }

  if (refs.length === 0) return context
  const first = refs[0]
  const last = refs[refs.length - 1]
  if (first === undefined || last === undefined) return context
  context.rootId = first.id
  // One e-tag: the positional form cannot distinguish root from parent.
  context.replyToId = last.id
  return context
}

export function isReply(source: Tagged): boolean {
  return parseThread(source).replyToId !== undefined
}

/** The root and parent a NIP-22 comment names, or undefined when this is not one. */
function commentScope(source: Tagged): { rootId?: Hex; parentId?: Hex } | undefined {
  let scoped = false
  let rootId: Hex | undefined
  let parentId: Hex | undefined
  for (const tag of source.tags) {
    if (tag[0] === 'E' || tag[0] === 'A' || tag[0] === 'I') {
      scoped = true
      if (tag[0] === 'E') rootId = normalizeHex(tag[1]) ?? rootId
      continue
    }
    // The LAST lowercase e-tag: NIP-22 expects one, and a client that writes more means.
    if (tag[0] === 'e') parentId = normalizeHex(tag[1]) ?? parentId
  }
  if (!scoped) return undefined
  const scope: { rootId?: Hex; parentId?: Hex } = {}
  if (rootId !== undefined) scope.rootId = rootId
  const parent = parentId ?? rootId
  if (parent !== undefined) scope.parentId = parent
  return scope
}

/** A NIP-22 comment, by kind. */
export function isComment(event: { kind: number }): boolean {
  return event.kind === KINDS.comment
}

/** The kind of the event a comment answers, from its `k` tag, and of the thread's root. */
export function parentKind(source: Tagged): number | undefined {
  return tagNumber(source, 'k')
}

export function rootKind(source: Tagged): number | undefined {
  return tagNumber(source, 'K')
}

function tagNumber(source: Tagged, name: string): number | undefined {
  for (const tag of source.tags) {
    if (tag[0] !== name) continue
    const value = Number(tag[1])
    if (Number.isInteger(value) && value >= 0) return value
  }
  return undefined
}

export function getThreadRoot(source: Tagged): Hex | undefined {
  return parseThread(source).rootId
}

/** The thread position a new reply to `parent` will occupy. */
export function replyContext(parent: NostrEvent): ThreadContext {
  const parentId = normalizeHex(parent.id)
  const parentAuthor = normalizeHex(parent.pubkey)
  const parentContext = parseThread(parent)
  const context: ThreadContext = {
    mentionedPubkeys: dedupeHex(
      parentAuthor === undefined ? parentContext.mentionedPubkeys : [parentAuthor, ...parentContext.mentionedPubkeys],
    ),
  }
  if (parentId === undefined) return context
  context.rootId = parentContext.rootId ?? parentId
  context.replyToId = parentId
  return context
}

export interface ReplyTagOptions {
  /** Who is composing the reply. */
  authorPubkey?: Hex
  /** Relay hint for the parent's e-tag. */
  relay?: RelayUrl
  /** Relay hint for the root's e-tag. */
  rootRelay?: RelayUrl
  /** Additional pubkeys to notify, e.g. */
  extraPubkeys?: readonly Hex[]
  /** Ceiling on carried p-tags, parent author first. */
  maxPubkeys?: number
}

const DEFAULT_MAX_PUBKEYS = 32

/** e/p tags for a reply to `parent`, written so that BOTH conventions read the same. */
export function buildReplyTags(parent: NostrEvent, options: ReplyTagOptions = {}): string[][] {
  const parentId = normalizeHex(parent.id)
  if (parentId === undefined) {
    throw new TypeError('buildReplyTags: parent.id is not 64-char lowercase hex')
  }
  const parentAuthor = normalizeHex(parent.pubkey)
  const parentContext = parseThread(parent)
  const rootId = parentContext.rootId ?? parentId
  const relay = tryNormalizeRelayUrl(options.relay ?? '') ?? ''
  const rootRelay = tryNormalizeRelayUrl(options.rootRelay ?? '') ?? ''

  const tags: string[][] = []
  if (rootId === parentId) {
    // Replying to a top-level note: one root-marked tag.
    tags.push(eTag(parentId, relay, 'root', parentAuthor))
  } else {
    tags.push(eTag(rootId, rootRelay, 'root', rootAuthor(parent, rootId)))
    tags.push(eTag(parentId, relay, 'reply', parentAuthor))
  }

  const address = rootAddress(parent)
  if (address !== undefined) tags.push(['a', address, rootRelay, 'root'])

  /* Order decides who survives `maxPubkeys`, so it is by INTENT, not by convenience. */
  const pubkeys: Hex[] = []
  if (parentAuthor !== undefined) pubkeys.push(parentAuthor)
  for (const extra of options.extraPubkeys ?? []) {
    const hex = normalizeHex(extra)
    if (hex !== undefined) pubkeys.push(hex)
  }
  pubkeys.push(...parentContext.mentionedPubkeys)
  const self = normalizeHex(options.authorPubkey)
  const max = options.maxPubkeys ?? DEFAULT_MAX_PUBKEYS
  for (const pubkey of dedupeHex(pubkeys).slice(0, Math.max(0, max))) {
    if (pubkey === self) continue
    tags.push(['p', pubkey])
  }
  return tags
}

/** kind-1 reply, threaded for both conventions, TAGGED FROM ITS OWN TEXT. */
export function buildReply(content: string, parent: NostrEvent, options: ReplyTagOptions & BuildOptions = {}): EventTemplate {
  const references = referencesFromContent(content)
  const mentioned: Hex[] = []
  for (const pubkey of references.pubkeys) {
    const hex = normalizeHex(pubkey)
    if (hex !== undefined) mentioned.push(hex)
  }

  const replyTags = buildReplyTags(parent, {
    ...options,
    extraPubkeys: [...(options.extraPubkeys ?? []), ...mentioned],
  })

  // A caller that already wrote its own `t` tags keeps them.
  const carried = options.tags ?? []
  const already = new Set(
    carried.filter(tag => tag[0] === 't' && tag[1] !== undefined).map(tag => tag[1]?.toLowerCase()),
  )
  const hashtagTags = references.hashtags.filter(tag => !already.has(tag)).map(tag => ['t', tag])

  const build: BuildOptions = { tags: [...replyTags, ...hashtagTags, ...carried] }
  if (options.createdAt !== undefined) build.createdAt = options.createdAt
  return buildShortNote(content, build)
}

/** A NIP-22 comment answering `parent`. */
export function buildComment(
  content: string,
  parent: NostrEvent,
  options: ReplyTagOptions & BuildOptions = {},
): EventTemplate {
  const parentId = normalizeHex(parent.id)
  if (parentId === undefined) {
    throw new TypeError('buildComment: parent.id is not 64-char lowercase hex')
  }
  const parentAuthor = normalizeHex(parent.pubkey)
  const relay = tryNormalizeRelayUrl(options.relay ?? '') ?? ''
  const rootRelay = tryNormalizeRelayUrl(options.rootRelay ?? '') ?? ''

  const tags: string[][] = []

  // Root scope: the parent's own, or the parent itself when it is the root.
  const inherited = getTags(parent, 'E')[0]
  if (inherited !== undefined && normalizeHex(inherited[1]) !== undefined) {
    tags.push(inherited)
    for (const name of ['K', 'P', 'A', 'I'] as const) {
      const carried = getTags(parent, name)[0]
      if (carried !== undefined) tags.push(carried)
    }
  } else {
    tags.push(scopeTag('E', parentId, rootRelay, parentAuthor))
    tags.push(['K', String(parent.kind)])
    if (parentAuthor !== undefined) tags.push(['P', parentAuthor, rootRelay])
    // An addressable root survives an edit only through its address.
    const address = isAddressable(parent.kind) ? eventAddress(parent) : undefined
    if (address !== undefined) tags.push(['A', address, rootRelay])
  }

  // Parent scope: always this event.
  tags.push(scopeTag('e', parentId, relay, parentAuthor))
  tags.push(['k', String(parent.kind)])
  /* The parent's author, unless that is the person writing. */
  const author = normalizeHex(options.authorPubkey)
  if (parentAuthor !== undefined && parentAuthor !== author) tags.push(['p', parentAuthor, relay])

  const references = referencesFromContent(content)
  const mentioned: Hex[] = []
  for (const pubkey of references.pubkeys) {
    const hex = normalizeHex(pubkey)
    if (hex !== undefined) mentioned.push(hex)
  }

  const participants: Hex[] = [...mentioned, ...parseThread(parent).mentionedPubkeys]
  const max = options.maxPubkeys ?? DEFAULT_MAX_PUBKEYS
  for (const pubkey of dedupeHex(participants).slice(0, Math.max(0, max))) {
    // The parent's author is already tagged above, and self-notifications are noise.
    if (pubkey === author || pubkey === parentAuthor) continue
    tags.push(['p', pubkey])
  }

  const carried = options.tags ?? []
  const already = new Set(
    carried.filter(tag => tag[0] === 't' && tag[1] !== undefined).map(tag => tag[1]?.toLowerCase()),
  )
  for (const tag of references.hashtags) {
    if (!already.has(tag)) tags.push(['t', tag])
  }

  return {
    kind: KINDS.comment,
    created_at: options.createdAt ?? nowSeconds(),
    tags: [...tags, ...carried],
    content,
  }
}

/** An `E`/`e` tag, with the author slot omitted rather than padded when unknown. */
function scopeTag(name: 'E' | 'e', id: Hex, relay: string, author: Hex | undefined): string[] {
  return author === undefined ? [name, id, relay] : [name, id, relay, author]
}

function eTag(id: Hex, relay: string, marker: ThreadMarker, author: Hex | undefined): string[] {
  // The author slot is positional, so it is omitted rather than padded when unknown.
  return author === undefined ? ['e', id, relay, marker] : ['e', id, relay, marker, author]
}

function rootAuthor(parent: NostrEvent, rootId: Hex): Hex | undefined {
  for (const ref of parseEventRefs(parent)) {
    if (ref.id === rootId && ref.author !== undefined) return ref.author
  }
  return undefined
}

/** Replies to a long-form article need an `a` tag as well as an `e` tag: the article. */
function rootAddress(parent: NostrEvent): string | undefined {
  if (isAddressable(parent.kind)) return eventAddress(parent)
  for (const tag of getTags(parent, 'a')) {
    const value = tag[1]
    if (value === undefined) continue
    if (tag[3] !== undefined && tag[3] !== 'root') continue
    if (parseAddress(value) === undefined) continue
    return value
  }
  return undefined
}

function dedupeHex(values: readonly Hex[]): Hex[] {
  const seen = new Set<Hex>()
  const out: Hex[] = []
  for (const value of values) {
    const hex = normalizeHex(value)
    if (hex === undefined || seen.has(hex)) continue
    seen.add(hex)
    out.push(hex)
  }
  return out
}

// --------------------------------------------------------------------------- Tree.

export interface ThreadNode {
  event: NostrEvent
  children: ThreadNode[]
  /** 0 for a node with no parent in this set. */
  depth: number
}

/** Flat event list to forest. */
export function buildThreadTree(events: readonly NostrEvent[]): ThreadNode[] {
  const byId = new Map<Hex, NostrEvent>()
  for (const event of events) {
    const id = normalizeHex(event.id)
    // The same note arrives from every relay.
    if (id === undefined || byId.has(id)) continue
    byId.set(id, event)
  }

  const parentOf = new Map<Hex, Hex>()
  for (const [id, event] of byId) {
    const replyToId = parseThread(event).replyToId
    if (replyToId === undefined || replyToId === id) continue
    if (byId.has(replyToId)) parentOf.set(id, replyToId)
  }

  // A crafted set of events can point at each other in a loop.
  for (const id of [...parentOf.keys()]) {
    const seen = new Set<Hex>([id])
    let cursor = parentOf.get(id)
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        parentOf.delete(id)
        break
      }
      seen.add(cursor)
      cursor = parentOf.get(cursor)
    }
  }

  const nodes = new Map<Hex, ThreadNode>()
  for (const [id, event] of byId) nodes.set(id, { event, children: [], depth: 0 })

  const roots: ThreadNode[] = []
  for (const [id, node] of nodes) {
    const parentId = parentOf.get(id)
    const parent = parentId === undefined ? undefined : nodes.get(parentId)
    if (parent === undefined) roots.push(node)
    else parent.children.push(node)
  }

  sortNodes(roots)
  const stack: ThreadNode[] = [...roots]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined) continue
    sortNodes(node.children)
    for (const child of node.children) {
      child.depth = node.depth + 1
      stack.push(child)
    }
  }
  return roots
}

/** Pre-order walk, which is the order a threaded timeline draws. */
export function flattenThread(nodes: readonly ThreadNode[]): ThreadNode[] {
  const out: ThreadNode[] = []
  const walk = (list: readonly ThreadNode[]): void => {
    for (const node of list) {
      out.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}

// Ties are broken by id so that two clients holding the same events draw them.
function sortNodes(nodes: ThreadNode[]): void {
  nodes.sort((a, b) =>
    a.event.created_at === b.event.created_at
      ? a.event.id.localeCompare(b.event.id)
      : a.event.created_at - b.event.created_at,
  )
}
