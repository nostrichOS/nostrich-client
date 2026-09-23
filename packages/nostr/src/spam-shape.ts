import { getTagValues } from './events'
import type { NostrEvent } from './types'

/** Judgements about the SHAPE of an event, with no reader in them. */

/** Distinct hashtags one note may carry and still be treated as a post about something. */
export const MAX_HASHTAGS = 5

/** Hashtags that condemn the ACCOUNT rather than the note. */
export const SPAMMER_HASHTAGS = 40

/** Mentions in a ROOT note past which it is a broadcast, not a post. */
export const MAX_ROOT_PTAGS = 25

/** The same question for a REPLY, and a much higher number. */
export const MAX_REPLY_PTAGS = 50

/** DISTINCT hashtags, lowercased and trimmed. */
export function distinctHashtags(event: NostrEvent): number {
  return new Set(
    getTagValues(event, 't')
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag !== ''),
  ).size
}

/** Distinct accounts this event addresses. */
export function distinctMentions(event: NostrEvent): number {
  return new Set(getTagValues(event, 'p').filter(pubkey => pubkey !== '')).size
}

/** Whether this is a root note rather than a reply, which changes what the mention cap. */
export function isRootNote(event: NostrEvent): boolean {
  return getTagValues(event, 'e').length === 0
}

/** Addressed to so many people that it is a broadcast. */
export function isHellthread(event: NostrEvent): boolean {
  const cap = isRootNote(event) ? MAX_ROOT_PTAGS : MAX_REPLY_PTAGS
  return distinctMentions(event) >= cap
}

/** More subjects than a person writes by hand. */
export function isTagStuffed(event: NostrEvent): boolean {
  return distinctHashtags(event) > MAX_HASHTAGS
}

/** More subjects than a person COULD write by hand. */
export function isTagStuffingAccount(event: NostrEvent): boolean {
  return distinctHashtags(event) >= SPAMMER_HASHTAGS
}

/** Notes by one author inside any window of this length, before the cadence stops. */
export const BURST_WINDOW_SECONDS = 10 * 60
export const BURST_LIMIT = 10

/** The most notes this author published in any `BURST_WINDOW_SECONDS` window. */
export function burstRate(events: readonly NostrEvent[], pubkey: string): number {
  const times = events
    .filter(event => event.pubkey === pubkey)
    .map(event => event.created_at)
    .sort((a, b) => a - b)
  if (times.length === 0) return 0

  // Two pointers over a sorted list: the widest count that fits inside one window.
  let best = 1
  let start = 0
  for (let end = 0; end < times.length; end += 1) {
    while ((times[end] as number) - (times[start] as number) > BURST_WINDOW_SECONDS) start += 1
    best = Math.max(best, end - start + 1)
  }
  return best
}

/** A cadence no person keeps up. */
export function isBursting(events: readonly NostrEvent[], pubkey: string): boolean {
  return burstRate(events, pubkey) >= BURST_LIMIT
}

/** GREETINGS ARE NOT CONTENT, and the engagement on one is not about the note. */
const GREETING_WORDS: ReadonlySet<string> = new Set([
  'gm', 'gn', 'gmgm', 'goodmorning', 'goodnight', 'goodevening', 'morning', 'night', 'evening',
  'gmnostr', 'gmfrens', 'gmfam', 'pv', 'puravida', 'hi', 'hello', 'hey', 'yo', 'sup',
  'lol', 'lmao', 'haha', 'hehe', 'wow', 'nice', 'cool', 'ok', 'okay', 'yes', 'no',
  'thanks', 'ty', 'gg', 'gmgmgm',
])

/** More words than this and it is a sentence, whatever the words. */
const GREETING_MAX_WORDS = 4

/** What a note says once its links, mentions, tags, emoji and punctuation are taken. */
export function spokenWords(content: string): string {
  return content
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/nostr:[a-z0-9]+/gi, ' ')
    .replace(/(?:^|\s)[#@]\S+/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    /* The invisible half of an emoji, which `Extended_Pictographic` does not cover. */
    .replace(/[\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{FE0E}]/gu, ' ')
    .replace(/[\p{M}\p{Cf}]/gu, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when a note's entire text is a greeting. */
export function isGreetingOnly(content: string): boolean {
  const spoken = spokenWords(content)
  // No words at all is a photo or a link, not a greeting.
  if (spoken === '') return false
  const words = spoken.toLowerCase().split(' ')
  if (words.length > GREETING_MAX_WORDS) return false
  return words.every(word => GREETING_WORDS.has(word))
}
