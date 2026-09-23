/** MERGE THE TWO INDEXES, THEN APPLY OUR OWN RULES. */

import {
  engagementScore,
  hasAdultName,
  advertisedHosts,
  advertisesCampaignDomain,
  hasSuppressedName,
  isBlockedFromDiscovery,
  isExcludedFromTrending,
  isGreetingOnly,
  isHellthread,
  isTagStuffed,
  linksToPhishingDomain,
  manipulatedEngagement,
  parseProfile,
  selfPromotingReply,
  type Hex,
  type NostrEvent,
  type Profile,
} from '@nostrich/nostr'

import type { SourceCounts, SourceNote, SourceResult } from './sources'
import type { VerifiedCounts } from './replies'

/** What one row of the served payload looks. */
export interface TrendingNote {
  id: Hex
  pubkey: Hex
  /** The event's own kind. */
  kind: number
  /** How many words the FULL body has, when the `content` here is only a preview. */
  words?: number
  createdAt: number
  content: string
  tags: string[][]
  counts: SourceCounts
  /** Our weighting of the counts. */
  score: number
  /** Which indexes offered it. Diagnostic, and it costs eight bytes. */
  sources: string[]
}

export interface TrendingPayload {
  hours: number
  builtAt: number
  notes: TrendingNote[]
  /** Author profiles, so the client's own gate and the rows themselves need no relay. */
  profiles: { pubkey: Hex; profile: Profile }[]
}

/** How many rows a window keeps. */
export const KEEP = 40

/** HOW OLD A NOTE MUST BE TO APPEAR IN A WINDOW AT ALL. */
const MIN_AGE_SECONDS: Readonly<Record<number, number>> = { 1: 0, 4: 3_600, 24: 4 * 3_600 }

/** Take the FULLER answer when both indexes have the same note. */
export function betterCounts(a: SourceCounts, b: SourceCounts): SourceCounts {
  return {
    replies: Math.max(a.replies, b.replies),
    reposts: Math.max(a.reposts, b.reposts),
    quotes: Math.max(a.quotes, b.quotes),
    reactions: Math.max(a.reactions, b.reactions),
    zapSats: Math.max(a.zapSats, b.zapSats),
    zapCount: Math.max(a.zapCount, b.zapCount),
  }
}

export interface Merged {
  id: Hex
  counts: SourceCounts
  event: NostrEvent | undefined
  sources: string[]
}

/** The union of what the indexes offered, one entry per note id. */
export function mergeSources(named: readonly { name: string; result: SourceResult }[]): Merged[] {
  const byId = new Map<Hex, Merged>()
  for (const { name, result } of named) {
    for (const note of result.notes) {
      const held = byId.get(note.id)
      if (held === undefined) {
        byId.set(note.id, {
          id: note.id,
          counts: note.counts,
          event: note.event,
          sources: [name],
        })
        continue
      }
      held.counts = betterCounts(held.counts, note.counts)
      // Whichever index shipped the note itself wins.
      held.event ??= note.event
      if (!held.sources.includes(name)) held.sources.push(name)
    }
  }
  return [...byId.values()]
}

/** Every reason a note can be refused, as a string, so a build logs WHY it dropped. */
export type Rejection =
  | 'no-event'
  | 'blocked'
  | 'not-trending'
  | 'tag-stuffed'
  | 'hellthread'
  | 'greeting-only'
  | 'phishing'
  | 'no-profile'
  | 'no-name'
  | 'no-picture'
  | 'adult-name'
  | 'suppressed-name'
  | 'campaign-domain'
  | 'no-nip05'
  | 'self-promoting-reply'
  | 'manipulated'
  | 'too-new'
  | 'duplicate-author'

export interface FilterOptions {
  /** kind-0 content by pubkey. A note whose author we know nothing about is not promoted. */
  profileOf: (pubkey: Hex) => Profile | undefined
  /** Kept in the shape for callers that still pass it, and no longer consulted. */
  requireNip05?: boolean
}

/** The verdict on ONE note. */
/** What a VERIFIED NIP-05 is worth on the chart. */
export const NIP05_BONUS = 5

export function rejectionFor(
  entry: Merged,
  options: FilterOptions,
): Rejection | undefined {
  const event = entry.event
  // the index gives ids without notes.
  if (event === undefined) return 'no-event'

  if (isBlockedFromDiscovery(event.pubkey as Hex)) return 'blocked'
  /* The charts-only exclusion. */
  if (isExcludedFromTrending(event.pubkey as Hex)) return 'not-trending'
  if (isTagStuffed(event)) return 'tag-stuffed'
  if (isHellthread(event)) return 'hellthread'
  /* A greeting is not a note. */
  if (isGreetingOnly(event.content)) return 'greeting-only'

  const profile = options.profileOf(event.pubkey as Hex)
  if (profile === undefined) return 'no-profile'
  const name = (profile.displayName ?? profile.name ?? '').trim()
  if (name === '') return 'no-name'
  if (hasAdultName(profile)) return 'adult-name'
  if (hasSuppressedName(profile)) return 'suppressed-name'
  /* The campaign domain the author claims, rather than the six hundred keys claiming. */
  if (advertisesCampaignDomain(profile)) return 'campaign-domain'
  // Checked here rather than with the other event rules because it only condemns a note.
  if (linksToPhishingDomain(event) && (profile.nip05 ?? '') === '') return 'phishing'
  /* NO PICTURE, NO CHART. */
  if ((profile.picture ?? '').trim() === '') return 'no-picture'
  /* A MISSING NIP-05 NO LONGER REJECTS, and the old rule was the worst of both things. */

  if (selfPromotingReply(event, advertisedHosts(profile))) return 'self-promoting-reply'
  if (
    manipulatedEngagement({
      replies: entry.counts.replies,
      likes: entry.counts.reactions,
      reposts: entry.counts.reposts,
      zapSats: entry.counts.zapSats,
    }) !== undefined
  ) {
    return 'manipulated'
  }
  return undefined
}

export interface BuildResult {
  payload: TrendingPayload
  offered: number
  rejected: Record<string, number>
}

/** The whole build for one window: merge, judge, rank, and keep one note per author. */
export function buildWindow(
  hours: number,
  named: readonly { name: string; result: SourceResult }[],
  builtAt: number,
  /** What each note earned in DISTINCT PEOPLE. */
  verified: ReadonlyMap<Hex, VerifiedCounts> = new Map(),
  /** The ids this window published LAST time, which break a tie in their own favour. */
  incumbents: ReadonlySet<Hex> = new Set(),
  /** Authors whose NIP-05 RESOLVED back to their own pubkey. */
  nip05Verified: ReadonlySet<Hex> = new Set(),
): BuildResult {
  const profileEvents = new Map<Hex, NostrEvent>()
  for (const { result } of named) {
    for (const event of result.profiles) {
      const held = profileEvents.get(event.pubkey as Hex)
      // Newest kind-0 wins.
      if (held === undefined || event.created_at > held.created_at) {
        profileEvents.set(event.pubkey as Hex, event)
      }
    }
  }
  const profiles = new Map<Hex, Profile>()
  for (const [pubkey, event] of profileEvents) {
    const parsed = parseProfile(event)
    if (parsed !== null) profiles.set(pubkey, parsed)
  }

  const merged = mergeSources(named).map(entry => {
    const counted = verified.get(entry.id)
    if (counted === undefined) return entry
    /* VERIFIED numbers replace the indexes' claims. */
    return {
      ...entry,
      counts: {
        ...entry.counts,
        replies: counted.replies,
        reposts: counted.reposts,
        quotes: counted.quotes,
        reactions: counted.reactions,
        zapCount: counted.zapCount,
        zapSats: counted.zapSats,
      },
    }
  })
  const rejected: Record<string, number> = {}
  const kept: TrendingNote[] = []

  for (const entry of merged) {
    // Old enough for this window.
    const minAge = MIN_AGE_SECONDS[hours] ?? 0
    if (minAge > 0 && entry.event !== undefined && builtAt - entry.event.created_at < minAge) {
      rejected['too-new'] = (rejected['too-new'] ?? 0) + 1
      continue
    }
    const reason = rejectionFor(entry, {
      profileOf: pubkey => profiles.get(pubkey),
      requireNip05: true,
    })
    if (reason !== undefined) {
      rejected[reason] = (rejected[reason] ?? 0) + 1
      continue
    }
    const event = entry.event as NostrEvent
    kept.push({
      id: entry.id,
      pubkey: event.pubkey as Hex,
      kind: event.kind,
      createdAt: event.created_at,
      content: event.content,
      tags: event.tags as string[][],
      counts: entry.counts,
      // For notes the verification pass reached, every term here is verified.
      score:
        engagementScore({
          replies: entry.counts.replies,
          reposts: entry.counts.reposts,
          quotes: entry.counts.quotes,
          reactions: entry.counts.reactions,
          zapCount: entry.counts.zapCount,
          zapSats: entry.counts.zapSats,
        }) + (nip05Verified.has(event.pubkey as Hex) ? NIP05_BONUS : 0),
      sources: entry.sources,
    })
  }

  /* Score, then incumbency, then id. */
  const held = (id: string): number => (incumbents.has(id as Hex) ? 0 : 1)
  kept.sort(
    (a, b) => b.score - a.score || held(a.id) - held(b.id) || (a.id < b.id ? -1 : 1),
  )

  const seenAuthors = new Set<Hex>()
  const notes: TrendingNote[] = []
  for (const note of kept) {
    if (seenAuthors.has(note.pubkey)) {
      rejected['duplicate-author'] = (rejected['duplicate-author'] ?? 0) + 1
      continue
    }
    seenAuthors.add(note.pubkey)
    notes.push(note)
    if (notes.length >= KEEP) break
  }

  return {
    payload: {
      hours,
      builtAt,
      notes,
      // Only the authors that survived.
      profiles: notes.map(note => ({ pubkey: note.pubkey, profile: profiles.get(note.pubkey) as Profile })),
    },
    offered: merged.length,
    rejected,
  }
}
