import { hasAdultName, parseProfile, type Hex, type NostrEvent, type Profile, type RelayUrl } from '@nostrich/nostr'

import {
  advertisedHosts,
  advertisesCampaignDomain,
  isBlockedFromDiscovery,
  isTagStuffed,
  selfPromotingReply,
  validateZapReceipt,
} from '@nostrich/nostr'
import { chunk, queryRelays } from './resolve'

/** COUNT THE REPLIES WE WOULD ACTUALLY SHOW, not the ones an index claims exist. */

/** Below these, a candidate is not worth re-counting: nothing is being laundered. */
const FLOOR = 5
const ZAP_FLOOR = 2
/** Aligned with `abuse.ts`'s reaction-flood floor on purpose: a note carrying enough. */
const REACTION_FLOOR = 10

/** WHAT A REPLIER HAS TO BE, BEFORE THEIR REPLY MAY RANK SOMEBODY ELSE'S NOTE. */
const MIN_NOTES = 10
const MIN_REPLIES = 10

/** What a note earned, counted in PEOPLE. */
export interface VerifiedCounts {
  replies: number
  /** All amplifying people. */
  reposts: number
  /** The quoters among `reposts`. */
  quotes: number
  reactions: number
  zapCount: number
  /** Sats summed from VALIDATED receipts only. */
  zapSats: number
}

export interface RecountResult {
  /** Note id → what it earned, in distinct people. */
  kept: Map<Hex, VerifiedCounts>
  /** Contributions dropped, for the build log. */
  dropped: number
}

/** The IDENTITY half of the gate, shared by every judged contributor. */
function establishedActor(pubkey: Hex, profile: Profile | null | undefined, history: History | undefined): boolean {
  if (isBlockedFromDiscovery(pubkey)) return false
  // No profile at all is the commonest shape of a farm: 24 of the 26 measured had none.
  if (profile === null || profile === undefined) return false

  // No display name.
  const name = (profile.displayName ?? profile.name ?? '').trim()
  if (name === '') return false
  // No picture.
  if ((profile.picture ?? '').trim() === '') return false
  if ((profile.nip05 ?? '').trim() === '') return false
  if (hasAdultName(profile)) return false
  /* Often unreachable. */
  if (advertisesCampaignDomain(profile)) return false

  /* A HISTORY, not just an identity. */
  if (history !== undefined && (history.notes < MIN_NOTES || history.replies < MIN_REPLIES)) {
    return false
  }
  return true
}

/** Whether a reply. */
function countable(reply: NostrEvent, profile: Profile | null, history: History | undefined): boolean {
  if (isTagStuffed(reply)) return false
  if (!establishedActor(reply.pubkey as Hex, profile, history)) return false
  if (profile !== null && selfPromotingReply(reply, advertisedHosts(profile))) return false
  return true
}

/** How much an account has actually published. */
interface History {
  notes: number
  replies: number
}

/** Notes and replies per author, counted from what the relays return. */
const AUTHORS_PER_FILTER = 8
const HISTORY_LIMIT = 200

async function historyFor(
  authors: readonly Hex[],
  relays: readonly RelayUrl[],
): Promise<Map<Hex, History>> {
  const events = await inBatches(chunk([...authors], AUTHORS_PER_FILTER), batch =>
    queryRelays([{ kinds: [1, 1111], authors: batch, limit: HISTORY_LIMIT }], relays),
  )
  const out = new Map<Hex, History>()
  for (const pubkey of authors) out.set(pubkey, { notes: 0, replies: 0 })
  const seen = new Set<string>()
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    const entry = out.get(event.pubkey as Hex)
    if (entry === undefined) continue
    // A reply carries an `e` tag.
    if (event.tags.some(tag => tag[0] === 'e')) entry.replies += 1
    else entry.notes += 1
  }
  return out
}

/** Re-count the replies of every candidate that claims enough of them to be worth. */
export async function recountReplies(
  candidates: readonly { id: Hex; replies: number; reposts: number; reactions: number; zapCount: number }[],
  relays: readonly RelayUrl[],
): Promise<RecountResult> {
  // Any one trigger is enough.
  const worth = candidates.filter(
    candidate =>
      candidate.replies >= FLOOR ||
      candidate.reposts >= FLOOR ||
      candidate.reactions >= REACTION_FLOOR ||
      candidate.zapCount >= ZAP_FLOOR,
  )
  if (worth.length === 0 || relays.length === 0) return { kept: new Map(), dropped: 0 }

  const ids = worth.map(candidate => candidate.id)
  const replies = await fetchReplies(ids, relays)
  if (replies.length === 0) return { kept: new Map(), dropped: 0 }

  /* A NOTE WHOSE REPLIES NOBODY CAN FIND HAS NO VERIFIED REPLIES. */
  const seenTargets = new Set<string>()
  for (const reply of replies) {
    for (const tag of reply.tags) {
      if ((tag[0] === 'e' || tag[0] === 'q') && tag[1] !== undefined) seenTargets.add(tag[1])
    }
  }
  const unverifiable = ids.filter(id => !seenTargets.has(id))

  // Everyone whose contribution is judged as a person: reply and quote authors.
  const authors = [
    ...new Set(replies.filter(e => JUDGED_KINDS.has(e.kind)).map(e => e.pubkey)),
  ] as Hex[]
  const [profiles, history] = await Promise.all([
    profilesFor(authors, relays),
    historyFor(authors, relays),
  ])

  const result = countShownReplies(ids, replies, profiles, history)
  for (const id of unverifiable) {
    result.kept.set(id, { replies: 0, reposts: 0, quotes: 0, reactions: 0, zapCount: 0, zapSats: 0 })
  }
  return result
}

/** The kinds whose actor faces the profile + history gate. */
const JUDGED_KINDS = new Set([1, 1111, 6, 16])

/** The counting itself, with no network. */
export function countShownReplies(
  ids: readonly Hex[],
  events: readonly NostrEvent[],
  profiles: ReadonlyMap<Hex, Profile | null>,
  history: ReadonlyMap<Hex, History> = new Map(),
  /** Other keys that mean the same candidate. */
  aliases: ReadonlyMap<string, Hex> = new Map(),
): RecountResult {
  /** note -> kind -> the distinct people who did it, plus the sats their validated zaps. */
  const people = new Map<Hex, { replies: Set<string>; reposts: Set<string>; quotes: Set<string>; reactions: Set<string>; zaps: Set<string>; sats: number }>()
  let dropped = 0
  const targets = new Map<string, Hex>(ids.map(id => [id as string, id]))
  for (const [key, id] of aliases) targets.set(key, id)

  // The person-sets dedupe themselves.
  const counted = new Set<string>()

  for (const event of events) {
    if (counted.has(event.id)) continue
    counted.add(event.id)
    const target = targetOf(event, targets)
    if (target === undefined) continue

    /* SEEN IS RECORDED SEPARATELY FROM COUNTED, and that distinction is the whole rule. */
    let bucket = people.get(target)
    if (bucket === undefined) {
      bucket = { replies: new Set(), reposts: new Set(), quotes: new Set(), reactions: new Set(), zaps: new Set(), sats: 0 }
      people.set(target, bucket)
    }

    if (event.kind === 9735) {
      /* ONLY A VALIDATED RECEIPT COUNTS. */
      const receipt = validateZapReceipt({ receipt: event })
      if (receipt.ok) {
        bucket.zaps.add(receipt.value.senderPubkey)
        bucket.sats += Math.floor(receipt.value.amountMsat / 1_000)
      } else {
        dropped += 1
      }
      continue
    }

    const actor = event.pubkey as Hex
    if (event.kind === 6 || event.kind === 16) {
      // A repost is ×2 per keypair, and until this gate it was the one heavy term any.
      if (establishedActor(actor, profiles.get(actor), history.get(actor))) bucket.reposts.add(actor)
      else dropped += 1
    } else if (event.kind === 7) {
      bucket.reactions.add(actor)
    } else if (quotesTarget(event, target, targets)) {
      // A quote is a repost AND a quote: it lands in `reposts`.
      if (countable(event, profiles.get(actor) ?? null, history.get(actor))) {
        bucket.reposts.add(actor)
        bucket.quotes.add(actor)
      } else dropped += 1
    } else if (countable(event, profiles.get(actor) ?? null, history.get(actor))) {
      bucket.replies.add(actor)
    } else {
      dropped += 1
    }
  }

  const kept = new Map<Hex, VerifiedCounts>()
  for (const [id, bucket] of people) {
    kept.set(id, {
      replies: bucket.replies.size,
      reposts: bucket.reposts.size,
      quotes: bucket.quotes.size,
      reactions: bucket.reactions.size,
      zapCount: bucket.zaps.size,
      zapSats: bucket.sats,
    })
  }
  return { kept, dropped }
}

/** Whether this event quotes THAT candidate. */
function quotesTarget(event: NostrEvent, target: Hex, targets: ReadonlyMap<string, Hex>): boolean {
  return event.tags.some(tag => tag[0] === 'q' && tag[1] !== undefined && targets.get(tag[1]) === target)
}

/** The candidate this event is about, or undefined when it is about something else. */
function targetOf(event: NostrEvent, targets: ReadonlyMap<string, Hex>): Hex | undefined {
  // `e`/`a` outrank `q`: an event that both replies to one candidate and quotes another.
  for (const tag of event.tags) {
    if ((tag[0] !== 'e' && tag[0] !== 'a') || tag[1] === undefined) continue
    const found = targets.get(tag[1])
    if (found !== undefined) return found
  }
  for (const tag of event.tags) {
    if (tag[0] !== 'q' || tag[1] === undefined) continue
    const found = targets.get(tag[1])
    if (found !== undefined) return found
  }
  return undefined
}

/** ALL BATCHES. */
async function inBatches<T, R>(items: T[], run: (item: T) => Promise<R[]>): Promise<R[]> {
  const pages = await Promise.all(items.map(run))
  return pages.flat()
}

/** SMALL BATCHES WITH AN EXPLICIT LIMIT, or most candidates come back empty. */
const IDS_PER_FILTER = 5
const REPLY_LIMIT = 500

/** Every kind that counts toward a score, asked for in ONE filter. */
const COUNTED_KINDS = [1, 1111, 6, 7, 16, 9735]
/** Quotes need a SECOND filter, not another entry in the first. */
const QUOTE_KINDS = [1, 1111]

async function fetchReplies(ids: readonly Hex[], relays: readonly RelayUrl[]): Promise<NostrEvent[]> {
  const batched = await inBatches(chunk([...ids], IDS_PER_FILTER), batch =>
    queryRelays(
      [
        { kinds: COUNTED_KINDS, '#e': batch, limit: REPLY_LIMIT },
        { kinds: QUOTE_KINDS, '#q': batch, limit: REPLY_LIMIT } as never,
      ],
      relays,
    ),
  )

  /* ONE ID PER FILTER FOR WHATEVER IS STILL SILENT. */
  const answered = new Set<string>()
  for (const event of batched) {
    for (const tag of event.tags) {
      if ((tag[0] === 'e' || tag[0] === 'q') && tag[1] !== undefined) answered.add(tag[1])
    }
  }
  const silent = ids.filter(id => !answered.has(id))
  if (silent.length === 0) return batched

  const singly = await inBatches([...silent], id =>
    queryRelays(
      [
        { kinds: COUNTED_KINDS, '#e': [id], limit: REPLY_LIMIT },
        { kinds: QUOTE_KINDS, '#q': [id], limit: REPLY_LIMIT } as never,
      ],
      relays,
    ),
  )
  return [...batched, ...singly]
}

/** Distinct-person counts for a set of candidates, verified against the relays. */
export async function countInteractions(
  targets: readonly { id: Hex; address?: string }[],
  relays: readonly RelayUrl[],
  /** How many candidates share one filter. */
  idsPerFilter = IDS_PER_FILTER,
): Promise<RecountResult> {
  if (targets.length === 0 || relays.length === 0) return { kept: new Map(), dropped: 0 }

  const ids = targets.map(target => target.id)
  const aliases = new Map<string, Hex>()
  for (const target of targets) {
    if (target.address !== undefined) aliases.set(target.address, target.id)
  }

  const events = await fetchInteractions(ids, [...aliases.keys()], relays, idsPerFilter)
  if (events.length === 0) return { kept: new Map(), dropped: 0 }

  // Reply, quote and repost authors are judged as people.
  const authors = [
    ...new Set(events.filter(e => JUDGED_KINDS.has(e.kind)).map(e => e.pubkey)),
  ] as Hex[]
  const [profiles, history] = await Promise.all([
    profilesFor(authors, relays),
    historyFor(authors, relays),
  ])
  return countShownReplies(ids, events, profiles, history, aliases)
}

/** Everything referencing these ids or these addresses, in as few filters as it can. */
async function fetchInteractions(
  ids: readonly Hex[],
  addresses: readonly string[],
  relays: readonly RelayUrl[],
  idsPerFilter: number,
): Promise<NostrEvent[]> {
  const byId = await inBatches(chunk([...ids], idsPerFilter), batch =>
    queryRelays(
      [
        { kinds: COUNTED_KINDS, '#e': batch, limit: REPLY_LIMIT },
        { kinds: QUOTE_KINDS, '#q': batch, limit: REPLY_LIMIT } as never,
      ],
      relays,
    ),
  )
  if (addresses.length === 0) return byId
  // `#q` here too: NIP-18 lets a quote of an addressable event name the ADDRESS.
  const byAddress = await inBatches(chunk([...addresses], idsPerFilter), batch =>
    queryRelays(
      [
        { kinds: COUNTED_KINDS, '#a': batch, limit: REPLY_LIMIT } as never,
        { kinds: QUOTE_KINDS, '#q': batch, limit: REPLY_LIMIT } as never,
      ],
      relays,
    ),
  )
  // Both tags on one event is common and would otherwise count somebody twice.
  const seen = new Set<string>()
  return [...byId, ...byAddress].filter(event => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  })
}

async function profilesFor(
  authors: readonly Hex[],
  relays: readonly RelayUrl[],
): Promise<Map<Hex, Profile | null>> {
  const events = await inBatches(chunk([...authors], 20), batch =>
    queryRelays([{ kinds: [0], authors: batch }], relays),
  )
  // Newest kind-0 wins: it is replaceable and relays hand back several versions.
  const newest = new Map<Hex, NostrEvent>()
  for (const event of events) {
    const held = newest.get(event.pubkey as Hex)
    if (held === undefined || event.created_at > held.created_at) newest.set(event.pubkey as Hex, event)
  }
  const out = new Map<Hex, Profile | null>()
  for (const [pubkey, event] of newest) out.set(pubkey, parseProfile(event))
  return out
}
