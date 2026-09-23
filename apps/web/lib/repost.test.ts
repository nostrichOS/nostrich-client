import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import { repostedEvent, unwrapRepost } from './repost'

const inner: NostrEvent = {
  id: 'f'.repeat(64),
  pubkey: 'a'.repeat(64),
  kind: 1,
  created_at: 1_787_364_657,
  tags: [['p', 'b'.repeat(64)]],
  content: 'the note somebody actually wrote',
  sig: '0'.repeat(128),
}

const repost = (content: string, kind = 6): NostrEvent =>
  ({ id: 'c'.repeat(64), pubkey: 'd'.repeat(64), kind, created_at: 1, tags: [['e', inner.id]], content, sig: '' }) as NostrEvent

describe('repostedEvent', () => {
  it('returns the note a kind-6 carries', () => {
    expect(repostedEvent(repost(JSON.stringify(inner)))?.content).toBe('the note somebody actually wrote')
  })

  it('handles a kind-16 generic repost the same way', () => {
    expect(repostedEvent(repost(JSON.stringify(inner), 16))?.id).toBe(inner.id)
  })

  it('returns nothing for the many reposts that carry no copy at all', () => {
    expect(repostedEvent(repost(''))).toBeUndefined()
    expect(repostedEvent(repost('   '))).toBeUndefined()
  })

  it('returns nothing for content that is not JSON, rather than throwing', () => {
    expect(repostedEvent(repost('nostr:nevent1abc'))).toBeUndefined()
    expect(repostedEvent(repost('{"content":"truncated'))).toBeUndefined()
  })

  it('refuses JSON that is not an event, so nothing renders undefined at a reader', () => {
    expect(repostedEvent(repost('{"content":"hi"}'))).toBeUndefined()
    expect(repostedEvent(repost(JSON.stringify({ ...inner, id: 'not-hex' })))).toBeUndefined()
    expect(repostedEvent(repost(JSON.stringify({ ...inner, tags: 'nope' })))).toBeUndefined()
  })

  it('leaves an ordinary note alone, even one whose content looks like JSON', () => {
    const note = { ...inner, content: JSON.stringify(inner) }
    expect(repostedEvent(note)).toBeUndefined()
  })
})

describe('unwrapRepost', () => {
  it('gives the note for a repost and the event itself for anything else', () => {
    expect(unwrapRepost(repost(JSON.stringify(inner))).id).toBe(inner.id)
    expect(unwrapRepost(inner).id).toBe(inner.id)
  })

  it('keeps the envelope when there is nothing inside to show', () => {
    const empty = repost('')
    expect(unwrapRepost(empty).id).toBe(empty.id)
  })

  it('passes undefined through, for a row that has no target yet', () => {
    expect(unwrapRepost(undefined)).toBeUndefined()
  })
})
