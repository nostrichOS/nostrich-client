/** NIP-51 mute list (kind 10000). */

import { getTag, nowSeconds } from './events'
import type { EventTemplate, Hex, NostrEvent } from './types'

export const MUTE_LIST_KIND = 10_000

/** Ceiling on a single list. */
export const MAX_MUTES = 2_000

export type MuteType = 'p' | 't' | 'word' | 'e'

/** One muted thing. `value` is a hex pubkey, a hashtag, a word, or a hex event id. */
export interface MuteEntry {
  type: MuteType
  value: string
}

export interface MuteList {
  /** Public entries, in the order the tags appeared. */
  publicItems: MuteEntry[]
  /** Entries recovered from the encrypted content, in their own order. */
  privateItems: MuteEntry[]
}

export const EMPTY_MUTES: MuteList = { publicItems: [], privateItems: [] }

const TYPES = new Set<string>(['p', 't', 'word', 'e'])

function isMuteType(value: string): value is MuteType {
  return TYPES.has(value)
}

/** Case is normalized for the things that are text and left alone for the things. */
function normalizeValue(type: MuteType, value: string): string {
  return type === 'p' || type === 'e' ? value.trim() : value.trim().toLowerCase()
}

/** Tags to entries, dropping anything that is not one of the four. */
export function parseMuteTags(tags: readonly (readonly string[])[]): MuteEntry[] {
  const out: MuteEntry[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const [name, raw] = tag
    if (name === undefined || raw === undefined) continue
    if (!isMuteType(name)) continue
    const value = normalizeValue(name, raw)
    if (value === '') continue
    const key = `${name}:${value}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type: name, value })
    if (out.length >= MAX_MUTES) break
  }
  return out
}

/** The public half. The private half needs a signer, so it is decrypted upstream. */
export function parseMuteList(event: NostrEvent): MuteEntry[] {
  if (event.kind !== MUTE_LIST_KIND) return []
  return parseMuteTags(event.tags)
}

/** Decrypted `content` to entries. */
export function parsePrivateMutes(plaintext: string): MuteEntry[] {
  if (plaintext.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(plaintext)
    if (!Array.isArray(parsed)) return []
    const tags = parsed.filter(
      (tag): tag is string[] => Array.isArray(tag) && tag.every(part => typeof part === 'string'),
    )
    return parseMuteTags(tags)
  } catch {
    return []
  }
}

export function muteKey(entry: MuteEntry): string {
  return `${entry.type}:${entry.value}`
}

/** Every entry as `type:value`, both halves, for O(1) "is this muted" checks. */
export function muteKeys(list: MuteList): Set<string> {
  const keys = new Set<string>()
  for (const item of list.publicItems) keys.add(muteKey(item))
  for (const item of list.privateItems) keys.add(muteKey(item))
  return keys
}

export function hasMute(list: MuteList, entry: MuteEntry): boolean {
  const key = muteKey({ type: entry.type, value: normalizeValue(entry.type, entry.value) })
  return (
    list.publicItems.some(item => muteKey(item) === key) ||
    list.privateItems.some(item => muteKey(item) === key)
  )
}

/** Just the muted accounts, which is the only type this client acts on today. */
export function mutedPubkeys(list: MuteList): Hex[] {
  const out: Hex[] = []
  for (const item of [...list.publicItems, ...list.privateItems]) {
    if (item.type === 'p') out.push(item.value as Hex)
  }
  return out
}

/** Add or remove one entry, returning a new list. */
export function toggleMute(list: MuteList, entry: MuteEntry): MuteList {
  const value = normalizeValue(entry.type, entry.value)
  const key = muteKey({ type: entry.type, value })

  if (hasMute(list, entry)) {
    return {
      publicItems: list.publicItems.filter(item => muteKey(item) !== key),
      privateItems: list.privateItems.filter(item => muteKey(item) !== key),
    }
  }
  return {
    publicItems: list.publicItems,
    privateItems: [{ type: entry.type, value }, ...list.privateItems],
  }
}

/** Fold local entries into a list from relays. */
export function mergeMutes(remote: MuteList, localEntries: readonly MuteEntry[]): MuteList {
  const existing = muteKeys(remote)
  const additions: MuteEntry[] = []
  for (const entry of localEntries) {
    const value = normalizeValue(entry.type, entry.value)
    if (value === '') continue
    const key = muteKey({ type: entry.type, value })
    if (existing.has(key)) continue
    existing.add(key)
    additions.push({ type: entry.type, value })
  }
  // New entries are private, like every other addition.
  return { publicItems: remote.publicItems, privateItems: [...additions, ...remote.privateItems] }
}

export function toMuteTags(items: readonly MuteEntry[]): string[][] {
  return items.map(item => [item.type, item.value])
}

/** The event to publish. */
export function buildMuteList({
  items,
  encryptedContent = '',
  previous,
  createdAt = nowSeconds(),
}: {
  items: readonly MuteEntry[]
  encryptedContent?: string
  previous?: NostrEvent
  createdAt?: number
}): EventTemplate {
  const carried = (previous?.tags ?? []).filter(tag => {
    const name = tag[0]
    return name === undefined || !isMuteType(name)
  })

  return {
    kind: MUTE_LIST_KIND,
    // A replaceable event only wins if it is newer.
    created_at: Math.max(createdAt, (previous?.created_at ?? 0) + 1),
    tags: [...toMuteTags(items.slice(0, MAX_MUTES)), ...carried.map(tag => [...tag])],
    content: encryptedContent,
  }
}

/** Plaintext for the private half: a JSON tag array, ready to encrypt to the author's. */
export function privateMutesPlaintext(items: readonly MuteEntry[]): string {
  return JSON.stringify(toMuteTags(items.slice(0, MAX_MUTES)))
}

/** NIP-01 replaceable tie-break: newest wins, and the lower id wins a tie on the second. */
export function newestMuteList(events: readonly NostrEvent[]): NostrEvent | undefined {
  let best: NostrEvent | undefined
  for (const event of events) {
    if (event.kind !== MUTE_LIST_KIND) continue
    if (best === undefined || event.created_at > best.created_at) {
      best = event
      continue
    }
    if (event.created_at === best.created_at && event.id < best.id) best = event
  }
  return best
}

/** Whether this event carries list metadata worth preserving. */
export function muteListTitle(event: NostrEvent): string | undefined {
  return getTag(event, 'title')?.[1]
}
