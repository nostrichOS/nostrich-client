import { describe, expect, it } from 'vitest'
import type { RelayEntry } from '@nostrich/nostr'

import { mergeRelayList } from './relay-publish'

/** PUBLISHING A RELAY LIST MUST NOT DELETE THE PARTS IT CANNOT SEE. */
const entry = (url: string, read: boolean, write: boolean): RelayEntry =>
  ({ url, policy: { read, write } }) as RelayEntry

describe('mergeRelayList', () => {
  it('keeps a write-only relay the reader was never shown', () => {
    // The import takes read relays only, so this never appears in their list here.
    const published = [entry('wss://read.example', true, true), entry('wss://write.example', false, true)]
    const merged = mergeRelayList(['wss://read.example'], published)
    expect(merged.map(e => e.url)).toContain('wss://write.example')
    expect(merged.find(e => e.url === 'wss://write.example')?.policy).toEqual({
      read: false,
      write: true,
    })
  })

  it('does not promote a read-only relay to read+write', () => {
    // Every entry used to be announced as a bare `r` tag.
    const published = [entry('wss://inbox.example', true, false)]
    const merged = mergeRelayList(['wss://inbox.example'], published)
    expect(merged).toEqual([entry('wss://inbox.example', true, false)])
  })

  it('drops a readable relay the reader removed', () => {
    // This one they DID see, so its absence is a decision and has to be honoured.
    const published = [entry('wss://a.example', true, true), entry('wss://b.example', true, true)]
    expect(mergeRelayList(['wss://a.example'], published).map(e => e.url)).toEqual([
      'wss://a.example',
    ])
  })

  it('adds a relay typed here as read and write', () => {
    // The app offers one list for both jobs, so claiming a narrower policy would.
    expect(mergeRelayList(['wss://new.example'], [])).toEqual([entry('wss://new.example', true, true)])
  })

  it('leaves published markers alone when nothing was chosen here', () => {
    /* This used to force `read` on for anything in the list, on the reasoning that being. */
    const published = [entry('wss://both.example', false, true)]
    expect(mergeRelayList(['wss://both.example'], published)).toEqual([
      entry('wss://both.example', false, true),
    ])
  })

  it('lets a choice made here outrank the published markers', () => {
    // Otherwise the dropdown would appear to work and change nothing: the merge would.
    const published = [entry('wss://paid.example', true, true)]
    expect(mergeRelayList(['wss://paid.example'], published, { 'wss://paid.example': 'write' })).toEqual([
      entry('wss://paid.example', false, true),
    ])
  })

  it('reads `both` as read and write', () => {
    const published = [entry('wss://a.example', true, false)]
    expect(mergeRelayList(['wss://a.example'], published, { 'wss://a.example': 'both' })).toEqual([
      entry('wss://a.example', true, true),
    ])
  })

  it('keeps the reader ordering, with unseen entries after it', () => {
    const published = [entry('wss://z.example', false, true), entry('wss://a.example', true, true)]
    expect(mergeRelayList(['wss://a.example', 'wss://b.example'], published).map(e => e.url)).toEqual([
      'wss://a.example',
      'wss://b.example',
      'wss://z.example',
    ])
  })

  it('is just the chosen list when nothing was ever published', () => {
    expect(mergeRelayList(['wss://a.example', 'wss://b.example'], []).map(e => e.url)).toEqual([
      'wss://a.example',
      'wss://b.example',
    ])
  })
})

describe('the policy actually reaches the event', () => {
  /** The dropdown appeared to do nothing, and the cause was not the dropdown. */
  it('publishes read-only when read-only was chosen', () => {
    const published = [entry('wss://paid.example', true, true)]
    const merged = mergeRelayList(['wss://paid.example'], published, {
      'wss://paid.example': 'read',
    })
    expect(merged).toEqual([entry('wss://paid.example', true, false)])
  })

  it('publishes read+write when the choice was cleared back to the default', () => {
    // `both` is stored as absent, so an explicit `both` and no entry must agree.
    const published = [entry('wss://a.example', false, true)]
    expect(mergeRelayList(['wss://a.example'], published, { 'wss://a.example': 'both' })).toEqual([
      entry('wss://a.example', true, true),
    ])
  })
})
