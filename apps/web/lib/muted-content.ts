'use client'

import { getTagValues, type Hex, type NostrEvent } from '@nostrich/nostr'

import { activeScope, readScoped, writeScoped } from './scope'
import { HIDE_NSFW_KEY } from './settings-keys'
import { isMuted, normalizeTerm, termMembers } from './user-lists'

/** WHY THIS NOTE IS NOT SHOWN. */

export type MuteHit =
  | { kind: 'author' }
  | { kind: 'hashtag'; term: string }
  | { kind: 'word'; term: string }
  | { kind: 'nsfw' }

/** Hashtags that mean "adult", for the #nsfw switch. */
const NSFW_TAGS = new Set(['nsfw', 'porn', 'xxx', 'adult'])

/** NIP-36's own marker, honoured alongside the hashtags. */
const CONTENT_WARNING = 'content-warning'

export function hideNsfw(): boolean {
  if (typeof window === 'undefined') return false
  // DEFAULT OFF.
  return readScoped(HIDE_NSFW_KEY) === '1'
}

export function setHideNsfw(on: boolean): void {
  writeScoped(HIDE_NSFW_KEY, on ? '1' : '0')
}

export function isNsfw(event: NostrEvent): boolean {
  if (event.tags.some(tag => tag[0] === CONTENT_WARNING)) return true
  return getTagValues(event, 't').some(tag => NSFW_TAGS.has(normalizeTerm(tag)))
}

/** The text a word filter is matched against: what the note SAYS. */
function searchableText(event: NostrEvent): string {
  return `${event.content ?? ''} ${getTagValues(event, 't').join(' ')}`.toLowerCase()
}

/** WHOLE WORDS, not substrings. */
function wordPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu')
}

/** Compiled patterns are cached: this runs once per note per render pass on a long. */
const patterns = new Map<string, RegExp>()

function patternFor(term: string): RegExp {
  let held = patterns.get(term)
  if (held === undefined) {
    held = wordPattern(term)
    patterns.set(term, held)
  }
  return held
}

/** Why this note is filtered, or undefined. */
export function mutedFor(event: NostrEvent): MuteHit | undefined {
  /** A READER'S FILTERS NEVER APPLY TO THE READER'S OWN NOTES. */
  if (event.pubkey === activeScope()) return undefined

  if (isMuted(event.pubkey as Hex)) return { kind: 'author' }

  const hashtags = termMembers('mutedHashtags')
  if (hashtags.length > 0) {
    const carried = new Set(getTagValues(event, 't').map(normalizeTerm))
    for (const term of hashtags) {
      // The `t` tag, or the word written into the body as `#term` by a client that did.
      if (carried.has(term) || (event.content ?? '').toLowerCase().includes(`#${term}`)) {
        return { kind: 'hashtag', term }
      }
    }
  }

  const words = termMembers('mutedWords')
  if (words.length > 0) {
    const text = searchableText(event)
    for (const term of words) {
      if (patternFor(term).test(text)) return { kind: 'word', term }
    }
  }

  if (hideNsfw() && isNsfw(event)) return { kind: 'nsfw' }

  return undefined
}

/** The boolean form, for the many call sites that only need to drop the note. */
export function isMutedContent(event: NostrEvent): boolean {
  return mutedFor(event) !== undefined
}

/** One sentence, in the reader's terms. */
export function muteReason(hit: MuteHit): string {
  switch (hit.kind) {
    case 'author':
      return 'You muted this account.'
    case 'hashtag':
      return `You muted #${hit.term}.`
    case 'word':
      return `You muted “${hit.term}”.`
    case 'nsfw':
      return 'This note is marked as adult content.'
  }
}
