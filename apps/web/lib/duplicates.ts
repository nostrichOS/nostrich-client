'use client'

import { KINDS, type Hex, type NostrEvent } from '@nostrich/nostr'

/** The same text, posted by several different accounts. */

/** Normalized characters below which repetition means nothing. */
export const MIN_LENGTH = 100

/** Distinct authors before identical text is a ring. */
export const MIN_AUTHORS = 3

/** Text stripped down to what was actually written. */
export function normalize(content: string): string {
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/nostr:[a-z0-9]+/g, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/[\p{Extended_Pictographic}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** FNV-1a. */
function hash(text: string): string {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value.toString(36)
}

export interface DuplicateOptions {
  /** Authors who are never folded, whatever the ring says. */
  exempt?: (pubkey: Hex) => boolean
}

/** Event ids that should collapse because the same text is circulating. */
export function findDuplicates(
  events: readonly NostrEvent[],
  options: DuplicateOptions = {},
): Map<string, number> {
  const buckets = new Map<string, { authors: Set<Hex>; copies: NostrEvent[] }>()

  for (const event of events) {
    /** Reposts and quotes are SUPPOSED to be identical. */
    if (event.kind === KINDS.repost || event.kind === KINDS.genericRepost) continue

    const text = normalize(event.content)
    /** Empty is not a match, it is an absence. */
    if (text.length < MIN_LENGTH) continue

    const key = hash(text)
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, { authors: new Set([event.pubkey]), copies: [event] })
      continue
    }
    bucket.authors.add(event.pubkey)
    bucket.copies.push(event)
  }

  const collapse = new Map<string, number>()
  for (const bucket of buckets.values()) {
    if (bucket.authors.size < MIN_AUTHORS) continue

    /** The earliest copy survives. */
    const ordered = [...bucket.copies].sort((a, b) => a.created_at - b.created_at)
    for (let i = 1; i < ordered.length; i += 1) {
      const copy = ordered[i] as NostrEvent
      if (options.exempt?.(copy.pubkey) === true) continue
      collapse.set(copy.id, bucket.authors.size)
    }
  }

  return collapse
}
