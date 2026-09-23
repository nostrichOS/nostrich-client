import { describe, expect, it } from 'vitest'

import { parseLongForm } from './events'
import type { NostrEvent } from './types'

/** `published_at` is the one field in a long-form event that a client can get wrong. */

const CREATED_AT = 1_783_736_726 // 2026-07-11

function article(publishedAt?: string): NostrEvent {
  return {
    id: 'f0e15ea486ea1bdf3d833d81f7ca706895860307373e235c1b98d4a7aaa4e19b',
    pubkey: '0'.repeat(64),
    created_at: CREATED_AT,
    kind: 30023,
    tags: [
      ['d', '2fQuuT3NmGwpyLOhadxjF'],
      ['title', 'Everywhere At Once'],
      ...(publishedAt === undefined ? [] : [['published_at', publishedAt]]),
    ],
    content: 'body',
    sig: '0'.repeat(128),
  }
}

describe('parseLongForm publishedAt', () => {
  it('keeps a well-formed seconds timestamp', () => {
    expect(parseLongForm(article('1694657868')).publishedAt).toBe(1_694_657_868)
  })

  it('converts a millisecond timestamp rather than trusting or discarding it', () => {
    // The real event that surfaced this: 1694657868105 reads as the year 55671 and pinned.
    expect(parseLongForm(article('1694657868105')).publishedAt).toBe(1_694_657_868)
  })

  it('falls back to created_at when the date is in the future', () => {
    expect(parseLongForm(article(String(CREATED_AT + 400_000))).publishedAt).toBe(CREATED_AT)
  })

  it('falls back to created_at when the date predates Nostr', () => {
    expect(parseLongForm(article('946684800')).publishedAt).toBe(CREATED_AT)
  })

  it('falls back to created_at when the tag is absent or unparseable', () => {
    expect(parseLongForm(article()).publishedAt).toBe(CREATED_AT)
    expect(parseLongForm(article('not-a-date')).publishedAt).toBe(CREATED_AT)
  })

  it('never sorts a converted date above a genuinely newer one', () => {
    const older = parseLongForm(article('1694657868105')).publishedAt ?? 0
    const newer = parseLongForm(article(String(CREATED_AT - 100))).publishedAt ?? 0
    expect(newer).toBeGreaterThan(older)
  })
})
