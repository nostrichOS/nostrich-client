import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readCachedTopics, writeCachedTopics, type Topic } from './explore'

/** The rule that keeps "No hashtags are trending right now" honest. */

const NOW = 1_800_000_000_000

const topic = (tag: string, notes: number): Topic => ({ tag, notes, atLeast: false, score: 2 })

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

describe('the topics cache', () => {
  it('stores a real list and reads it back', () => {
    writeCachedTopics(24, [topic('bitcoin', 320), topic('news', 456)])
    const held = readCachedTopics(24)
    expect(held?.topics.map(t => t.tag)).toEqual(['bitcoin', 'news'])
    expect(held?.at).toBe(NOW)
  })

  /** The sample behind this is a thousand kind-1 notes off the relay set. */
  it('refuses to store an empty result', () => {
    writeCachedTopics(24, [])
    expect(readCachedTopics(24)).toBeUndefined()
  })

  /** The important half: one bad sample must not erase a good answer already on disk. */
  it('does not overwrite a good list with an empty one', () => {
    writeCachedTopics(24, [topic('bitcoin', 320)])
    writeCachedTopics(24, [])
    expect(readCachedTopics(24)?.topics.map(t => t.tag)).toEqual(['bitcoin'])
  })

  it('keeps each window separate', () => {
    writeCachedTopics(24, [topic('bitcoin', 320)])
    writeCachedTopics(1, [topic('nostr', 12)])
    expect(readCachedTopics(24)?.topics.map(t => t.tag)).toEqual(['bitcoin'])
    expect(readCachedTopics(1)?.topics.map(t => t.tag)).toEqual(['nostr'])
    // And an empty write to one window leaves the other alone.
    writeCachedTopics(1, [])
    expect(readCachedTopics(24)?.topics.map(t => t.tag)).toEqual(['bitcoin'])
  })

  it('treats a damaged store as no cache rather than throwing', () => {
    localStorage.setItem('nostrich:topics:v4', '{not json')
    expect(readCachedTopics(24)).toBeUndefined()
  })
})
