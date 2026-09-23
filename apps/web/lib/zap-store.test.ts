import { beforeEach, describe, expect, it } from 'vitest'
import type { Hex } from '@nostrich/nostr'

import type { ZapDetail } from './interactions'
import { addPendingZap, forgetZaps, markZapsSettled, rememberZaps, settlePendingZap, zapsFor, zapsSettled } from './zap-store'

/** Six surfaces render a zap strip and each used to answer from its own fetch, so one. */

const NOTE = 'a'.repeat(64)
const ALICE = 'b'.repeat(64) as Hex
const BOB = 'c'.repeat(64) as Hex
const zap = (sender: Hex, sats: number, at: number): ZapDetail => ({ sender, sats, at })

beforeEach(() => {
  localStorage.clear()
  forgetZaps()
})

describe('the shared zap store', () => {
  it('has nothing to say about a note nobody has looked at', () => {
    expect(zapsFor(NOTE)).toBeUndefined()
  })

  it('merges two partial answers instead of replacing one with the other', () => {
    // The timeline found the small ones.
    rememberZaps(NOTE, [zap(ALICE, 111, 20)])
    rememberZaps(NOTE, [zap(BOB, 666, 10)])
    expect(zapsFor(NOTE)).toHaveLength(2)
    expect(Math.max(...(zapsFor(NOTE) ?? []).map(z => z.sats))).toBe(666)
  })

  it('NEVER shrinks when a thinner answer arrives afterwards', () => {
    // The exact regression: opening a note showed 666, going back to the timeline showed.
    rememberZaps(NOTE, [zap(BOB, 666, 10), zap(ALICE, 111, 20)])
    rememberZaps(NOTE, [zap(ALICE, 111, 20)])
    expect(Math.max(...(zapsFor(NOTE) ?? []).map(z => z.sats))).toBe(666)
  })

  it('counts the same zap once however many relays deliver it', () => {
    rememberZaps(NOTE, [zap(ALICE, 21, 5)])
    rememberZaps(NOTE, [zap(ALICE, 21, 5)])
    rememberZaps(NOTE, [zap(ALICE, 21, 5)])
    expect(zapsFor(NOTE)).toHaveLength(1)
  })

  it('keeps two real zaps from one person apart', () => {
    rememberZaps(NOTE, [zap(ALICE, 21, 5), zap(ALICE, 21, 9)])
    expect(zapsFor(NOTE)).toHaveLength(2)
  })

  it('holds the list newest-first, which is what the row of faces reads', () => {
    rememberZaps(NOTE, [zap(ALICE, 1, 10), zap(BOB, 2, 30), zap(ALICE, 3, 20)])
    expect((zapsFor(NOTE) ?? []).map(z => z.at)).toEqual([30, 20, 10])
  })

  it('ignores an empty answer rather than recording one', () => {
    rememberZaps(NOTE, [])
    expect(zapsFor(NOTE)).toBeUndefined()
  })

  it('keeps notes apart', () => {
    const other = 'd'.repeat(64)
    rememberZaps(NOTE, [zap(ALICE, 5, 1)])
    rememberZaps(other, [zap(BOB, 900, 1)])
    expect(Math.max(...(zapsFor(NOTE) ?? []).map(z => z.sats))).toBe(5)
    expect(Math.max(...(zapsFor(other) ?? []).map(z => z.sats))).toBe(900)
  })
})

/** When the strip is allowed to show itself. */
describe('settled', () => {
  it('starts unsettled, so a first sighting waits for the relays', () => {
    expect(zapsSettled(NOTE)).toBe(false)
  })

  it('is set for every note a finished fetch covered', () => {
    markZapsSettled([NOTE, 'd'.repeat(64)])
    expect(zapsSettled(NOTE)).toBe(true)
    expect(zapsSettled('d'.repeat(64))).toBe(true)
  })

  it('says nothing about a note that fetch did not cover', () => {
    markZapsSettled([NOTE])
    expect(zapsSettled('e'.repeat(64))).toBe(false)
  })

  it('is not confused by an empty id or an undefined one', () => {
    markZapsSettled([''])
    expect(zapsSettled('')).toBe(false)
    expect(zapsSettled(undefined)).toBe(false)
  })

  it('is independent of whether any zaps were found', () => {
    // A note with no zaps still settles.
    markZapsSettled([NOTE])
    expect(zapsFor(NOTE)).toBeUndefined()
    expect(zapsSettled(NOTE)).toBe(true)
  })
})

/** A zap appears the instant the reader presses, and is taken back if the payment fails. */
describe('optimistic zaps', () => {
  it('shows immediately, flagged as pending', () => {
    addPendingZap(NOTE, { sender: ALICE, sats: 500, at: 100 })
    expect(zapsFor(NOTE)).toEqual([{ sender: ALICE, sats: 500, at: 100, pending: true }])
  })

  it('takes it back when the payment fails', () => {
    const entry = addPendingZap(NOTE, { sender: ALICE, sats: 500, at: 100 })
    settlePendingZap(NOTE, entry, false)
    expect(zapsFor(NOTE)).toBeUndefined()
  })

  it('KEEPS it on success, because the real receipt is minutes away', () => {
    // Removing it on success would make the zap vanish and reappear, which is a worse lie.
    const entry = addPendingZap(NOTE, { sender: ALICE, sats: 500, at: 100 })
    settlePendingZap(NOTE, entry, true)
    expect(zapsFor(NOTE)).toHaveLength(1)
  })

  it('is retired by the real receipt rather than doubling it', () => {
    // The clocks differ.
    addPendingZap(NOTE, { sender: ALICE, sats: 500, at: 100 })
    rememberZaps(NOTE, [{ sender: ALICE, sats: 500, at: 137 }])
    expect(zapsFor(NOTE)).toEqual([{ sender: ALICE, sats: 500, at: 137 }])
  })

  it('leaves somebody else pending zap alone when a receipt lands', () => {
    addPendingZap(NOTE, { sender: BOB, sats: 21, at: 100 })
    rememberZaps(NOTE, [{ sender: ALICE, sats: 500, at: 137 }])
    expect(zapsFor(NOTE)).toHaveLength(2)
  })

  it('does not remove a settled zap that happens to match a failed one', () => {
    // Only the pending copy is taken back.
    rememberZaps(NOTE, [{ sender: ALICE, sats: 500, at: 90 }])
    const entry = addPendingZap(NOTE, { sender: ALICE, sats: 500, at: 100 })
    settlePendingZap(NOTE, entry, false)
    expect(zapsFor(NOTE)).toEqual([{ sender: ALICE, sats: 500, at: 90 }])
  })

  it('leaves the store alone when settling something it never held', () => {
    settlePendingZap(NOTE, { sender: ALICE, sats: 1, at: 1, pending: true }, false)
    expect(zapsFor(NOTE)).toBeUndefined()
  })
})
