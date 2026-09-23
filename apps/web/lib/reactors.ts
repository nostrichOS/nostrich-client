'use client'

import { reactionFlavour, reactionMarkOf } from './reactions'
import { useEffect, useMemo, useRef, useState } from 'react'
import { KINDS, isReply, type Hex, type NostrEvent } from '@nostrich/nostr'

import { getPool } from './pool'
import { isSuppressed } from './spam'

/** WHO reacted to a note, not merely how many did. */

/** A zap receipt carries its amount inside the bolt11 invoice. */
const AMOUNT_RE = /lnbc(\d+)([munp])/i
const UNIT_DIV: Record<string, number> = { m: 1e3, u: 1e6, n: 1e9, p: 1e12 }

/** Per FILTER, not per request. */
const LIMIT = 500

export interface Reactor {
  /** The person. For a zap this is the payer, not the recipient. */
  pubkey: Hex
  /** When we saw their reaction. */
  createdAt: number
  /** What they sent, drawn as-is: an emoji, or the literal `:shortcode:`. */
  emoji?: string
  /** A NIP-30 custom emoji's image, when the reaction named one. */
  emojiUrl?: string
  /** Zaps only, summed across every zap this person sent to the note. */
  sats?: number
  /** Zaps only: the comment attached to the zap request. */
  comment?: string
  /** Quotes only: the note that did the quoting, so the row can link. */
  quoteId?: string
}

export interface Reactors {
  reactions: Reactor[]
  reposts: Reactor[]
  quotes: Reactor[]
  zaps: Reactor[]
  /** Total sats across every zap, which is not the same as `zaps.length`. */
  zapSats: number
  loading: boolean
}

const EMPTY: Reactors = {
  reactions: [],
  reposts: [],
  quotes: [],
  zaps: [],
  zapSats: 0,
  loading: true,
}

function satsOf(receipt: NostrEvent): number {
  const bolt11 = receipt.tags.find(tag => tag[0] === 'bolt11')?.[1]
  if (bolt11 === undefined) return 0
  const match = AMOUNT_RE.exec(bolt11)
  const unit = match?.[2]?.toLowerCase()
  const raw = Number(match?.[1])
  if (unit === undefined || !Number.isFinite(raw)) return 0
  const div = UNIT_DIV[unit]
  return div === undefined ? 0 : Math.round((raw / div) * 1e8)
}

/** The payer, from the zap request the receipt embeds. */
function payerOf(receipt: NostrEvent): { pubkey: Hex; comment?: string } | undefined {
  const description = receipt.tags.find(tag => tag[0] === 'description')?.[1]
  if (description !== undefined) {
    try {
      const request: unknown = JSON.parse(description)
      if (typeof request === 'object' && request !== null) {
        const author = (request as NostrEvent).pubkey
        const comment = (request as NostrEvent).content?.trim()
        if (typeof author === 'string' && author.length === 64) {
          return { pubkey: author as Hex, ...(comment === undefined || comment === '' ? {} : { comment }) }
        }
      }
    } catch {
      // A malformed description is a broken receipt, not a reason to drop the zap.
    }
  }
  const tagged = receipt.tags.find(tag => tag[0] === 'P')?.[1]
  return tagged !== undefined && tagged.length === 64 ? { pubkey: tagged as Hex } : undefined
}

/** A kind-1 that REFERS to the note rather than answering. */
function quotesNote(event: NostrEvent, noteId: string): boolean {
  if (event.tags.some(tag => tag[0] === 'q' && tag[1] === noteId)) return true
  return event.tags.some(tag => tag[0] === 'e' && tag[1] === noteId) && !isReply(event)
}

export function useReactors(noteId: Hex | undefined, enabled = true): Reactors {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(true)
  const seen = useRef(new Set<string>())

  useEffect(() => {
    if (noteId === undefined || !enabled) return
    seen.current = new Set()
    setEvents([])
    setLoading(true)

    let raf = 0
    let batch: NostrEvent[] = []
    const sub = getPool().subscribe({
      filters: [
        { kinds: [KINDS.reaction], '#e': [noteId], limit: LIMIT },
        { kinds: [KINDS.repost, 16], '#e': [noteId], limit: LIMIT },
        // Kind 1111 alongside kind 1: a NIP-22 comment is a reply, and it answers on the same.
        { kinds: [KINDS.shortNote, KINDS.comment], '#e': [noteId], limit: LIMIT },
        // Quotes published with `q` alone: `q` is single-letter, so relays index.
        { kinds: [KINDS.shortNote], '#q': [noteId], limit: LIMIT },
        { kinds: [9735], '#e': [noteId], limit: LIMIT },
      ],
      onEvent: (event: NostrEvent) => {
        // The same reaction arrives from every relay that holds.
        if (seen.current.has(event.id)) return
        seen.current.add(event.id)
        batch.push(event)
        // Coalesced to a frame: a popular note's reactions arrive in bursts of dozens.
        if (raf === 0) {
          raf = requestAnimationFrame(() => {
            raf = 0
            const arrived = batch
            batch = []
            setEvents(current => [...current, ...arrived])
          })
        }
      },
      onEose: () => setLoading(false),
    })

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      sub.close()
    }
  }, [noteId, enabled])

  return useMemo((): Reactors => {
    if (noteId === undefined) return EMPTY

    /** One row per PERSON, not per event. */
    const newest = (into: Map<Hex, Reactor>, entry: Reactor): void => {
      const held = into.get(entry.pubkey)
      if (held === undefined || entry.createdAt > held.createdAt) into.set(entry.pubkey, entry)
    }

    const reactions = new Map<Hex, Reactor>()
    const reposts = new Map<Hex, Reactor>()
    const quotes = new Map<Hex, Reactor>()
    const zaps = new Map<Hex, Reactor>()
    let zapSats = 0

    for (const event of events) {
      // Suppressed accounts do not exist in this client, including in a list of who reacted.
      if (isSuppressed(event.pubkey)) continue

      if (event.kind === KINDS.reaction) {
        /* A DISLIKE IS NOT LISTED. */
        if (reactionFlavour(event.content) === 'dislike') continue
        const mark = reactionMarkOf(event.content, event.tags)
        newest(reactions, {
          pubkey: event.pubkey,
          createdAt: event.created_at,
          ...(mark === undefined
            ? {}
            : { emoji: mark.display, ...(mark.url === undefined ? {} : { emojiUrl: mark.url }) }),
        })
        continue
      }

      if (event.kind === KINDS.repost || event.kind === 16) {
        newest(reposts, { pubkey: event.pubkey, createdAt: event.created_at })
        continue
      }

      if (event.kind === KINDS.shortNote) {
        if (!quotesNote(event, noteId)) continue
        newest(quotes, { pubkey: event.pubkey, createdAt: event.created_at, quoteId: event.id })
        continue
      }

      if (event.kind === 9735) {
        const payer = payerOf(event)
        const sats = satsOf(event)
        if (payer === undefined || sats === 0) continue
        if (isSuppressed(payer.pubkey)) continue
        zapSats += sats
        const held = zaps.get(payer.pubkey)
        zaps.set(payer.pubkey, {
          pubkey: payer.pubkey,
          createdAt: Math.max(held?.createdAt ?? 0, event.created_at),
          sats: (held?.sats ?? 0) + sats,
          // The newest comment wins, so a person who zapped again with something to say.
          ...(payer.comment === undefined
            ? held?.comment === undefined
              ? {}
              : { comment: held.comment }
            : { comment: payer.comment }),
        })
      }
    }

    const byTime = (a: Reactor, b: Reactor): number => b.createdAt - a.createdAt

    return {
      reactions: [...reactions.values()].sort(byTime),
      reposts: [...reposts.values()].sort(byTime),
      quotes: [...quotes.values()].sort(byTime),
      // Zaps rank by size.
      zaps: [...zaps.values()].sort((a, b) => (b.sats ?? 0) - (a.sats ?? 0)),
      zapSats,
      loading,
    }
  }, [events, loading, noteId])
}
