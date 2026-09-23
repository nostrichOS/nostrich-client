'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeBolt11, isReply, KINDS, validateZapReceipt, type Hex, type NostrEvent } from '@nostrich/nostr'

import { trendingFloor } from './trending'

import { onPublished } from './published'
import { getPool } from './pool'
import { parentOf } from './thread'
import { markZapsSettled } from './zap-store'

/** Reply / zap / like / repost counts for the notes currently on screen. */

/** Note ids per filter. */
const CHUNK = 500

/** One filter per note, for a handful of notes that must each be counted honestly. */
/** Events one chunked filter may return. */
/** Ids per ZAP filter, far smaller than `CHUNK`. */
const ZAP_CHUNK = 25

const CHUNK_LIMIT = 1_000

const PER_NOTE_MAX = 5
/** Deep enough that no note our panels show is truncated in practice. */
const PER_NOTE_LIMIT = 500

/** How many reply authors to remember per note. */
export const MAX_REPLY_AUTHORS = 20

/** How much a reply has to say before its author counts as social proof. */
export const MIN_PROOF_REPLY_CHARS = 25

/** Whether a reply is substantial enough to name its author under the note. */
export function saysSomething(content: string): boolean {
  return [...content.trim()].length >= MIN_PROOF_REPLY_CHARS
}

export interface Counts {
  replies: number
  /** Who wrote the replies, capped and deduped. */
  replyAuthors: Hex[]
  likes: number
  /** All amplifications. */
  reposts: number
  /** The quote subset of `reposts`, for the score's ×1 top-up. */
  quotes: number
  zapSats: number
  /** DISTINCT ZAPS, which is what ranking uses. */
  zapCount: number
}

const EMPTY: Counts = { replies: 0, likes: 0, reposts: 0, quotes: 0, zapSats: 0, zapCount: 0, replyAuthors: [] }

/** The batched tally's zap figures, raised by a note's OWN authoritative zap query. */
export function liftZapCounts(base: Counts | undefined, zaps: readonly ZapDetail[]): Counts | undefined {
  if (zaps.length === 0) return base
  const sats = zaps.reduce((total, zap) => total + zap.sats, 0)
  const held = base ?? EMPTY
  const zapCount = Math.max(held.zapCount, zaps.length)
  const zapSats = Math.max(held.zapSats, sats)
  if (base !== undefined && zapCount === held.zapCount && zapSats === held.zapSats) return base
  return { ...held, zapCount, zapSats }
}

/** One zap on a note, kept rather than merely counted. */
export interface ZapDetail {
  /** Shown before the money has actually moved. */
  pending?: boolean
  /** Who paid, from the signed zap request inside the receipt. */
  sender: Hex
  sats: number
  /** What they typed with it. The emoji people attach IS the message on most zaps. */
  comment?: string
  at: number
  /** The signed zap REQUEST's id, when it is known. */
  requestId?: string
}

/** Trim to the cap without ever losing the biggest zap. */
export function capZaps(newestFirst: readonly ZapDetail[], cap = ZAPS_PER_NOTE): ZapDetail[] {
  if (newestFirst.length <= cap) return [...newestFirst]
  let biggest = newestFirst[0] as ZapDetail
  for (const zap of newestFirst) {
    if (zap.sats > biggest.sats || (zap.sats === biggest.sats && zap.at < biggest.at)) biggest = zap
  }
  const kept = newestFirst.slice(0, cap)
  if (kept.includes(biggest)) return kept
  // Displace the oldest of the kept window rather than growing past the cap.
  kept[kept.length - 1] = biggest
  return kept.sort((a, b) => b.at - a.at)
}

/** Kept per note. */
const ZAPS_PER_NOTE = 12

export interface InteractionState {
  counts: Map<string, Counts>
  /** Individual zaps per note, newest first. */
  zaps: Map<string, ZapDetail[]>
  /** True once every targeted relay has sent EOSE. */
  settled: boolean
}

/** How long the id list must stop changing before the subscription is rebuilt. */
const SETTLE_MS = 600

/** `key`, but only once it has held still. */
function useSettledKey(key: string, delayMs: number): string {
  const [settled, setSettled] = useState(key)

  useEffect(() => {
    if (settled === '' || key === '') {
      setSettled(key)
      return
    }
    const timer = setTimeout(() => setSettled(key), delayMs)
    return () => clearTimeout(timer)
  }, [key, settled, delayMs])

  return settled
}

export function useInteractions(
  noteIds: readonly Hex[],
  opts?: {
    /** Give every note its own filter. */
     perNote?: boolean
    /** Ask for zap receipts and nothing else. */
    zapsOnly?: boolean
    /** Addressable targets, as `kind:pubkey:identifier` -> the note id standing. */
    addresses?: ReadonlyMap<string, Hex>
  },
): InteractionState {
  const [counts, setCounts] = useState<Map<string, Counts>>(() => new Map())
  const [zaps, setZaps] = useState<Map<string, ZapDetail[]>>(() => new Map())
  const [settled, setSettled] = useState(false)
  // The id list is a fresh array every render.
  const key = useSettledKey(noteIds.join(','), SETTLE_MS)
  // Read back OUT of the settled key rather than from `noteIds`, so what is subscribed.
  const subscribed = useMemo((): Hex[] => (key === '' ? [] : (key.split(',') as Hex[])), [key])
  // Both persist across subscriptions on purpose.
  const seen = useRef(new Set<string>())
  const tally = useRef(new Map<string, Counts>())
  const zapDetail = useRef(new Map<string, ZapDetail[]>())

  useEffect(() => {
    if (subscribed.length === 0) {
      setSettled(true)
      return
    }
    setSettled(false)
    // NOT reset: `seen` stops an event being counted twice across resubscribes.
    let raf = 0

    const bump = (id: string, patch: Partial<Counts>): void => {
      const current = tally.current.get(id) ?? { ...EMPTY }
      tally.current.set(id, {
        replies: current.replies + (patch.replies ?? 0),
        // Deduped and capped: one person answering six times is one face, and a busy thread.
        replyAuthors:
          patch.replyAuthors === undefined
            ? current.replyAuthors
            : [...new Set([...current.replyAuthors, ...patch.replyAuthors])].slice(
                0,
                MAX_REPLY_AUTHORS,
              ),
        likes: current.likes + (patch.likes ?? 0),
        reposts: current.reposts + (patch.reposts ?? 0),
        quotes: current.quotes + (patch.quotes ?? 0),
        zapSats: current.zapSats + (patch.zapSats ?? 0),
        zapCount: current.zapCount + (patch.zapCount ?? 0),
      })
      // Coalesce to one state update per frame.
      if (raf === 0) {
        raf = requestAnimationFrame(() => {
          raf = 0
          setCounts(new Map(tally.current))
          setZaps(new Map(zapDetail.current))
        })
      }
    }

    /** Newest first, capped, and deduplicated by receipt id upstream by `seen`. */
    const remember = (id: string, zap: ZapDetail): void => {
      const held = zapDetail.current.get(id) ?? []
      held.push(zap)
      held.sort((a, b) => b.at - a.at)
      zapDetail.current.set(id, capZaps(held))
    }

    const ids = new Set(subscribed)
    const chunks: Hex[][] = []
    const idList = [...ids]
    for (let i = 0; i < idList.length; i += CHUNK) chunks.push(idList.slice(i, i + CHUNK))

    // KINDS.comment is NIP-22: another client writes replies to notes as kind 1111.
    const kinds = [KINDS.shortNote, KINDS.comment, KINDS.repost, KINDS.genericRepost, KINDS.reaction, 9735]
    /* TWO FILTERS PER CHUNK, because a quote does not carry an `e` tag. */
    const quoteKinds = [KINDS.shortNote, KINDS.comment]
    const perNote = opts?.perNote === true && idList.length <= PER_NOTE_MAX
    /* The quote filter exists to fix a REPOST count, so it goes with the counts. */
    const zapsOnly = opts?.zapsOnly === true
    const askFor = zapsOnly ? [9735] : kinds
    const addresses = opts?.addresses
    const addressList = addresses === undefined ? [] : [...addresses.keys()]
    const addressChunks: string[][] = []
    for (let at = 0; at < addressList.length; at += CHUNK) {
      addressChunks.push(addressList.slice(at, at + CHUNK))
    }
    /* Zaps are chunked separately and much more finely. */
    const zapChunks: Hex[][] = []
    for (let at = 0; at < idList.length; at += ZAP_CHUNK) {
      zapChunks.push(idList.slice(at, at + ZAP_CHUNK))
    }
    const zapAddressChunks: string[][] = []
    for (let at = 0; at < addressList.length; at += ZAP_CHUNK) {
      zapAddressChunks.push(addressList.slice(at, at + ZAP_CHUNK))
    }
    const countKinds = askFor.filter(kind => kind !== 9735)

    const sub = getPool().subscribe({
      filters: perNote
        ? idList.flatMap(id =>
            zapsOnly
              ? [{ kinds: askFor, '#e': [id], limit: PER_NOTE_LIMIT }]
              : [
                  { kinds: askFor, '#e': [id], limit: PER_NOTE_LIMIT },
                  { kinds: quoteKinds, '#q': [id], limit: PER_NOTE_LIMIT },
                ],
          )
        : [
            // Zaps: narrow chunks, so the limit is spent on these notes and not on five hundred.
            ...zapChunks.map(chunk => ({ kinds: [9735], '#e': chunk, limit: CHUNK_LIMIT })),
            ...zapAddressChunks.map(chunk => ({ kinds: [9735], '#a': chunk, limit: CHUNK_LIMIT })),
            // Everything else: wide chunks.
            ...(zapsOnly || countKinds.length === 0
              ? []
              : chunks.flatMap(chunk => [
                  { kinds: countKinds, '#e': chunk, limit: CHUNK_LIMIT },
                  { kinds: quoteKinds, '#q': chunk, limit: CHUNK_LIMIT },
                ])),
            ...(zapsOnly || countKinds.length === 0
              ? []
              : addressChunks.map(chunk => ({ kinds: countKinds, '#a': chunk, limit: CHUNK_LIMIT }))),
          ],
      onEvent: handle,
      onEose: () => {
        setSettled(true)
        markZapsSettled(subscribed)
      },
    })

    /* The reader's OWN like, repost, reply or zap, counted the moment it is published. */
    const stopPublished = onPublished(handle)

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      stopPublished()
      sub.close()
    }

    function handle(event: NostrEvent): void {
        // The same reaction arrives from every relay.
        if (seen.current.has(event.id)) return

        const target = targetOf(event, ids, addresses)
        // NOT marked seen yet.

        // `seen` outlives the subscription (that is what stops counts flickering), so marking.
        if (target === undefined) return
        seen.current.add(event.id)

        switch (event.kind) {
          // A NIP-22 comment is a reply that is not a kind-1.
          case KINDS.comment:
          case KINDS.shortNote:
            /** A QUOTE is not a reply, and NIP-10 says so with a marker. */
            /** A quote counts as a repost. */
            // A `q` tag naming THIS note settles it: the event quotes the note rather.
            if (isReply(event) && !quotes(event, target)) {
              /* The COUNT takes every answer in the thread. */
              const direct = parentOf(event) === target
              bump(target, {
                replies: 1,
                // `saysSomething` is the second half of the same idea: a direct answer, and an answer.
                ...(direct && saysSomething(event.content)
                  ? { replyAuthors: [event.pubkey as Hex] }
                  : {}),
              })
            }
            // Both counters: the quote shows in the repost number AND earns the score top-up.
            else bump(target, { reposts: 1, quotes: 1 })
            break
          case KINDS.repost:
          case KINDS.genericRepost:
            bump(target, { reposts: 1 })
            break
          case KINDS.reaction:
            // A kind-7 with content "-" is a DOWNVOTE.
            if (event.content.trim() !== '-') bump(target, { likes: 1 })
            break
          case 9735: {
            const sats = zapSats(event)
            // One receipt is one zap, whatever it carried.
            bump(target, { zapSats: sats, zapCount: 1 })
            /* The sender and comment come from the SIGNED zap request inside the receipt. */
            const result = validateZapReceipt({ receipt: event })
            if (result.ok && sats > 0) {
              const receipt = result.value
              remember(target, {
                sender: receipt.senderPubkey,
                sats,
                ...(receipt.comment === undefined || receipt.comment === ''
                  ? {}
                  : { comment: receipt.comment }),
                at: receipt.createdAt,
              })
            }
            break
          }
        }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `subscribed` is derived from `key`
  }, [key, opts?.perNote, opts?.zapsOnly])

  /** The tally, never below what the trending index already said about the same note. */
  const floored = useMemo(() => {
    let changed = false
    const out = new Map<string, Counts>()
    /* A NOTE WE HAVE SEEN NOTHING FOR STILL GETS THE INDEX'S NUMBERS. */
    const wanted = new Set<string>([...counts.keys(), ...noteIds])
    for (const id of wanted) {
      const held = counts.get(id)
      const count = held ?? EMPTY
      const floor = trendingFloor(id as Hex)
      if (floor === undefined) {
        // Nothing known about it from either side.
        if (held !== undefined) out.set(id, count)
        continue
      }
      // An id the index knows and our own tally does not is itself a change.
      if (held === undefined) changed = true
      const lifted: Counts = {
        replies: Math.max(count.replies, floor.replies),
        likes: Math.max(count.likes, floor.reactions),
        reposts: Math.max(count.reposts, floor.reposts),
        quotes: Math.max(count.quotes, floor.quotes),
        zapSats: Math.max(count.zapSats, floor.zapSats),
        zapCount: Math.max(count.zapCount, floor.zapCount),
        // The floor is a set of NUMBERS from the trending index.
        replyAuthors: count.replyAuthors,
      }
      if (
        lifted.replies !== count.replies ||
        lifted.likes !== count.likes ||
        lifted.reposts !== count.reposts ||
        lifted.quotes !== count.quotes ||
        lifted.zapSats !== count.zapSats ||
        // `zapCount` was lifted above and then not asked about, so a lift that moved ONLY.
        lifted.zapCount !== count.zapCount
      ) {
        changed = true
      }
      out.set(id, lifted)
    }
    // Identity preserved when nothing was lifted, so this does not re-render.
    return changed ? out : counts
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the stable form of noteIds
  }, [counts, key])

  return { counts: floored, zaps, settled }
}

/** Which note on screen this event. */
export function targetOf(
  event: NostrEvent,
  ids: ReadonlySet<string>,
  /** `kind:pubkey:identifier` -> the note id it stands. */
  addresses?: ReadonlyMap<string, Hex>,
): Hex | undefined {
  const replied = lastETag(event)
  if (replied !== undefined && ids.has(replied)) return replied
  if (addresses !== undefined) {
    for (const tag of event.tags) {
      if (tag[0] !== 'a') continue
      const target = tag[1] === undefined ? undefined : addresses.get(tag[1])
      if (target !== undefined) return target
    }
  }
  if (event.kind !== KINDS.shortNote) return undefined
  for (const tag of event.tags) {
    if (tag[0] !== 'q') continue
    const id = tag[1]
    if (id !== undefined && ids.has(id)) return id
  }
  return undefined
}

/** NIP-10: the note being reacted to is the last e-tag, or the one marked `reply`. */
function lastETag(event: NostrEvent): Hex | undefined {
  let last: Hex | undefined
  for (const tag of event.tags) {
    if (tag[0] !== 'e') continue
    const id = tag[1]
    if (id === undefined) continue
    if (tag[3] === 'reply') return id
    last = id
  }
  return last
}

/** Whether this event quotes that note, by NIP-18's `q` tag. */
export function quotes(event: NostrEvent, id: string): boolean {
  return event.tags.some(tag => tag[0] === 'q' && tag[1] === id)
}

/** The amount a zap receipt carries, read with the package's real bolt11 decoder. */
function zapSats(receipt: NostrEvent): number {
  const bolt11 = receipt.tags.find(tag => tag[0] === 'bolt11')?.[1]
  if (bolt11 === undefined) return 0
  const invoice = decodeBolt11(bolt11)
  if (invoice === null || invoice.amountMsat === null) return 0
  return Math.round(invoice.amountMsat / 1_000)
}
