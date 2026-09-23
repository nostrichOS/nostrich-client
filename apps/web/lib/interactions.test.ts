import { describe, expect, it } from 'vitest'
import { KINDS, type Hex, type NostrEvent } from '@nostrich/nostr'

import { capZaps, quotes, targetOf, type ZapDetail } from './interactions'

/** Attributing an interaction to the note. */

const NOTE = 'a'.repeat(64) as Hex
const OTHER = 'b'.repeat(64) as Hex
const scope = (...ids: Hex[]): ReadonlySet<string> => new Set(ids)

const event = (tags: string[][], kind: number = KINDS.shortNote): NostrEvent =>
  ({ id: 'c'.repeat(64), pubkey: 'd'.repeat(64), created_at: 0, kind, tags, content: '', sig: '' }) as NostrEvent

describe('targetOf', () => {
  it('attributes a quote that carries only a q tag', () => {
    // Exactly the shape measured on the reported note: p, q, zap, client.
    const amethystQuote = event([
      ['p', OTHER, 'wss://nos.lol/'],
      ['q', NOTE, 'wss://relay-a.example/', OTHER],
      ['client', 'SomeClient'],
    ])
    expect(targetOf(amethystQuote, scope(NOTE))).toBe(NOTE)
    expect(quotes(amethystQuote, NOTE)).toBe(true)
  })

  it('still attributes a reply by its e tag', () => {
    expect(targetOf(event([['e', NOTE, '', 'reply']]), scope(NOTE))).toBe(NOTE)
  })

  it('prefers the note being replied to when an event does both', () => {
    // A reply to A that also quotes B belongs in A's thread.
    const both = event([
      ['e', NOTE, '', 'reply'],
      ['q', OTHER],
    ])
    expect(targetOf(both, scope(NOTE, OTHER))).toBe(NOTE)
    expect(targetOf(both, scope(OTHER))).toBe(OTHER)
    // And against B it is a quote, not an answer.
    expect(quotes(both, OTHER)).toBe(true)
    expect(quotes(both, NOTE)).toBe(false)
  })

  it('ignores an event about a note nobody is counting', () => {
    expect(targetOf(event([['q', OTHER]]), scope(NOTE))).toBeUndefined()
    expect(targetOf(event([['e', OTHER]]), scope(NOTE))).toBeUndefined()
  })

  it('reads q tags only on notes, never on a reaction or a zap receipt', () => {
    // A kind-7 or a 9735 says what it is about with `e`.
    expect(targetOf(event([['q', NOTE]], KINDS.reaction), scope(NOTE))).toBeUndefined()
    expect(targetOf(event([['q', NOTE]], 9735), scope(NOTE))).toBeUndefined()
    expect(targetOf(event([['e', NOTE]], KINDS.reaction), scope(NOTE))).toBe(NOTE)
  })
})

/** A LONG-FORM ARTICLE IS REFERENCED BY ADDRESS, NOT BY ID. */
describe('addressable targets', () => {
  const ARTICLE_ID = 'a'.repeat(64) as Hex
  const AUTHOR = 'b'.repeat(64)
  const ADDRESS = `30023:${AUTHOR}:my-slug`
  const addresses = new Map([[ADDRESS, ARTICLE_ID]])

  function tagged(tags: string[][]): NostrEvent {
    return { id: 'r'.repeat(64), pubkey: 'c'.repeat(64), created_at: 1, kind: 7, tags, content: '+', sig: '0'.repeat(128) }
  }

  it('attributes a reaction carrying only an `a` tag', () => {
    expect(targetOf(tagged([['a', ADDRESS]]), new Set(), addresses)).toBe(ARTICLE_ID)
  })

  it('ignores an address for something not on screen', () => {
    expect(targetOf(tagged([['a', `30023:${AUTHOR}:other`]]), new Set(), addresses)).toBeUndefined()
  })

  it('still prefers a direct `e` tag when there is one', () => {
    const target = targetOf(tagged([['e', ARTICLE_ID], ['a', ADDRESS]]), new Set([ARTICLE_ID]), addresses)
    expect(target).toBe(ARTICLE_ID)
  })

  it('changes nothing for callers that pass no addresses', () => {
    expect(targetOf(tagged([['a', ADDRESS]]), new Set())).toBeUndefined()
  })
})

/** The zap strip reads two different questions off one list: the biggest zap. */
describe('capZaps', () => {
  const zap = (sats: number, at: number): ZapDetail => ({ sender: 'a'.repeat(64) as Hex, sats, at })
  // Newest first, as `remember` holds them.
  const newestFirst = (...pairs: [number, number][]) =>
    pairs.map(([sats, at]) => zap(sats, at)).sort((a, b) => b.at - a.at)

  it('leaves a list inside the cap alone', () => {
    const held = newestFirst([5, 3], [9, 2])
    expect(capZaps(held, 4)).toEqual(held)
  })

  it('KEEPS THE BIGGEST even when it is the oldest thing there', () => {
    const held = newestFirst([1, 10], [2, 9], [3, 8], [1000, 1])
    const kept = capZaps(held, 3)
    expect(kept).toHaveLength(3)
    expect(Math.max(...kept.map(z => z.sats))).toBe(1000)
  })

  it('spends the rest of the budget on the newest', () => {
    const held = newestFirst([1, 10], [2, 9], [3, 8], [1000, 1])
    const kept = capZaps(held, 3)
    expect(kept.map(z => z.at)).toEqual([10, 9, 1])
  })

  it('drops the oldest of the window, not the newest', () => {
    const held = newestFirst([1, 10], [2, 9], [3, 8], [4, 7], [500, 1])
    expect(capZaps(held, 3).map(z => z.sats)).toEqual([1, 2, 500])
  })

  it('breaks a tie on amount towards the earlier zap, so the strip stops reshuffling', () => {
    const held = newestFirst([9, 10], [1, 9], [9, 2])
    const kept = capZaps(held, 2)
    expect(kept.some(z => z.at === 2)).toBe(true)
  })

  it('stays newest-first afterwards, which is what the faces read', () => {
    const held = newestFirst([1, 10], [2, 9], [3, 8], [1000, 1])
    const kept = capZaps(held, 3)
    expect([...kept].sort((a, b) => b.at - a.at)).toEqual(kept)
  })
})
