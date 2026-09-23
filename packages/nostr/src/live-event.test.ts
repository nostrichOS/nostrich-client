import { describe, expect, it } from 'vitest'

import { liveEventAt, parseLiveEvent, type LiveEvent } from './live-event'
import type { NostrEvent } from './types'

const HOST = 'd3495bbc01ac822936ee78943d0db59768278cf834f63d6a356f85823f7121ff'
const PLATFORM = 'f9f64238b262b1bcc39356b377acc9b17ede1d57ad949ee7f9dd1ef6b74f892d'

const event = (tags: string[][], overrides: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: 'e'.repeat(64),
    pubkey: PLATFORM,
    kind: 30311,
    created_at: 1_788_000_000,
    content: '',
    sig: '',
    tags,
    ...overrides,
  }) as NostrEvent

describe('parseLiveEvent', () => {
  it('reads the fields a card draws', () => {
    const live = parseLiveEvent(
      event([
        ['d', 'f1399b75-c7bb-42f6-a4fc-dceef8344e0b'],
        ['title', "mar says.. let's game today.. tunic.."],
        ['image', 'https://example.com/cover.jpg'],
        ['status', 'live'],
        ['starts', '1788000000'],
        ['current_participants', '12'],
        ['p', HOST, 'wss://relay.example.com', 'Host'],
      ]),
    )
    expect(live.title).toBe("mar says.. let's game today.. tunic..")
    expect(live.status).toBe('live')
    expect(live.currentParticipants).toBe(12)
    expect(live.host).toBe(HOST)
  })

  it('credits the HOST, not the platform that published the event', () => {
    /* The note that prompted all this was published by `LFL` on the streamer's behalf. */
    const live = parseLiveEvent(event([['p', HOST, '', 'Host']]))
    expect(live.host).toBe(HOST)
    expect(live.host).not.toBe(PLATFORM)
  })

  it('matches the Host role case-insensitively', () => {
    // The spec writes "Host".
    expect(parseLiveEvent(event([['p', HOST, '', 'host']])).host).toBe(HOST)
  })

  it('falls back to the author when nothing claims the Host role', () => {
    expect(parseLiveEvent(event([['p', HOST, '', 'Speaker']])).host).toBe(PLATFORM)
    expect(parseLiveEvent(event([])).host).toBe(PLATFORM)
  })

  it('treats a missing status as unknown, never as ended', () => {
    // Announcing somebody's stream as over because a tag was not written is the one error.
    expect(parseLiveEvent(event([])).status).toBe('unknown')
    expect(parseLiveEvent(event([['status', 'LIVE']])).status).toBe('live')
    expect(parseLiveEvent(event([['status', 'whatever']])).status).toBe('unknown')
  })

  it('drops counts that are not clean integers rather than coercing them', () => {
    // Real tags, written by whoever ran the stream.
    expect(parseLiveEvent(event([['current_participants', '']])).currentParticipants).toBeUndefined()
    expect(parseLiveEvent(event([['current_participants', 'none']])).currentParticipants).toBeUndefined()
    expect(parseLiveEvent(event([['current_participants', '1.5']])).currentParticipants).toBeUndefined()
    // Zero IS a real audience count and must survive, unlike a zero timestamp.
    expect(parseLiveEvent(event([['current_participants', '0']])).currentParticipants).toBe(0)
  })

  it('treats a zero timestamp as absent', () => {
    expect(parseLiveEvent(event([['starts', '0']])).starts).toBeUndefined()
  })

  it('keeps empty strings out of the struct', () => {
    const live = parseLiveEvent(event([['title', '   '], ['image', '']]))
    expect(live.title).toBeUndefined()
    expect(live.image).toBeUndefined()
  })
})

describe('liveEventAt', () => {
  const base: LiveEvent = {
    identifier: 'x', title: undefined, summary: undefined, image: undefined,
    status: 'unknown', starts: undefined, ends: undefined,
    currentParticipants: undefined, totalParticipants: undefined,
    host: HOST as never, streaming: undefined, recording: undefined,
  }

  it('dates an ended stream by when it ended', () => {
    expect(liveEventAt({ ...base, status: 'ended', starts: 100, ends: 900 }, event([]))).toBe(900)
  })

  it('dates a running stream by when it started', () => {
    expect(liveEventAt({ ...base, status: 'live', starts: 100, ends: 900 }, event([]))).toBe(100)
  })

  it('falls back to the event timestamp so a card is never undated', () => {
    expect(liveEventAt(base, event([]))).toBe(1_788_000_000)
  })
})
