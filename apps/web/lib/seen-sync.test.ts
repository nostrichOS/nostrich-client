import { describe, expect, it } from 'vitest'

import { buildSeenPayload, mergeSeen, parseSeenPayload, chatFromPayload, cappedChat } from './seen-sync'

/** Read markers are high-water marks, which is what lets two devices agree. */
describe('mergeSeen', () => {
  it('takes the later marker from whichever side has it', () => {
    expect(mergeSeen({ notifications: 100, zaps: 50 }, { notifications: 200, zaps: 10 })).toEqual({
      notifications: 200,
      zaps: 50,
    })
  })

  /** A device that has been offline for a week must not resurrect a week of notifications. */
  it('never moves a marker backwards', () => {
    expect(mergeSeen({ notifications: 900, zaps: 900 }, { notifications: 1, zaps: 1 })).toEqual({
      notifications: 900,
      zaps: 900,
    })
  })

  it('ignores anything that is not a usable timestamp', () => {
    const local = { notifications: 10, zaps: 10 }
    for (const junk of [{ notifications: 'soon' }, { notifications: -5 }, { zaps: Number.NaN }, {}]) {
      expect(mergeSeen(local, junk as Record<string, unknown>)).toEqual(local)
    }
  })

  it('treats the two columns separately, because reading one is not reading the other', () => {
    expect(mergeSeen({ notifications: 0, zaps: 500 }, { notifications: 700, zaps: 0 })).toEqual({
      notifications: 700,
      zaps: 500,
    })
  })
})

describe('the stored payload', () => {
  it('round-trips', () => {
    const markers = { notifications: 1_700_000_000, zaps: 1_690_000_000 }
    expect(parseSeenPayload(buildSeenPayload(markers, {}))).toMatchObject(markers)
  })

  /** Two clients quietly erasing each other's fields is the failure this prevents. */
  it('keeps fields a newer client wrote that this one does not understand', () => {
    const payload = buildSeenPayload({ notifications: 5, zaps: 6 }, { articles: 99, v: 2 })
    expect(parseSeenPayload(payload)).toEqual({ articles: 99, v: 2, notifications: 5, zaps: 6 })
  })

  it('survives somebody else’s data in our slot', () => {
    for (const junk of ['', 'not json', '[]', 'null', '42']) {
      expect(parseSeenPayload(junk)).toEqual({})
    }
  })
})

/** The chat half of the payload. */
describe('chatFromPayload', () => {
  it('takes the markers it can trust', () => {
    expect(chatFromPayload({ chat: { 'a:b': 1700, 'c:d': 1800 } })).toEqual({ 'a:b': 1700, 'c:d': 1800 })
  })

  it('is empty when there is no chat half at all', () => {
    expect(chatFromPayload({})).toEqual({})
    expect(chatFromPayload({ chat: null })).toEqual({})
    expect(chatFromPayload({ chat: 'nope' })).toEqual({})
  })

  it('refuses an array, which is an object and is not a map', () => {
    expect(chatFromPayload({ chat: [1, 2] })).toEqual({})
  })

  it('drops values that are not usable timestamps', () => {
    // A marker that is not a positive finite number would be merged with Math.max and can.
    const out = chatFromPayload({
      chat: { good: 1700, zero: 0, negative: -5, nan: Number.NaN, infinite: Infinity, text: '1700' },
    })
    expect(out).toEqual({ good: 1700 })
  })
})

describe('cappedChat', () => {
  it('passes a small map through untouched', () => {
    expect(cappedChat({ 'a:b': 1, 'c:d': 2 })).toEqual({ 'a:b': 1, 'c:d': 2 })
  })

  it('keeps the newest markers when there are too many', () => {
    const all: Record<string, number> = {}
    for (let i = 0; i < 250; i += 1) all[`k${i}`] = i
    const capped = cappedChat(all)
    expect(Object.keys(capped)).toHaveLength(200)
    // The oldest 50 are the ones dropped.
    expect(capped['k249']).toBe(249)
    expect(capped['k50']).toBe(50)
    expect(capped['k49']).toBeUndefined()
  })

  it("does not hand back the caller's own object", () => {
    const all = { 'a:b': 1 }
    const capped = cappedChat(all)
    capped['a:b'] = 999
    expect(all['a:b']).toBe(1)
  })
})
