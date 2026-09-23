import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import { ownCountsSince, __recordForTest } from './own-actions'

const NOTE = 'a'.repeat(64)

const like = (id: string, at: number, content = '+'): NostrEvent =>
  ({ id, kind: 7, content, created_at: at, pubkey: 'p'.repeat(64), tags: [['e', NOTE]], sig: '' }) as NostrEvent

describe('the own-actions ledger', () => {
  it('counts an own like only when it is newer than the index build', () => {
    __recordForTest(like('1'.repeat(64), 1000))
    expect(ownCountsSince(NOTE, 900).likes).toBe(1)
    // The next rebuild (builtAt >= created_at) absorbs it: counting stops, no double count.
    expect(ownCountsSince(NOTE, 1000).likes).toBe(0)
  })

  it('never counts a dislike', () => {
    __recordForTest(like('2'.repeat(64), 1000, '-'))
    expect(ownCountsSince(NOTE, 0).likes).toBe(1) // only the like from the test above
  })

  it('records each event once, however many times the rail replays it', () => {
    const event = like('3'.repeat(64), 1000)
    __recordForTest(event)
    __recordForTest(event)
    expect(ownCountsSince(NOTE, 900).likes).toBe(2) // '1…' and '3…'
  })

  it('a deletion retracts exactly the action it names', () => {
    __recordForTest({
      id: 'd'.repeat(64), kind: 5, content: '', created_at: 1100, pubkey: 'p'.repeat(64),
      tags: [['e', '3'.repeat(64)]], sig: '',
    } as NostrEvent)
    expect(ownCountsSince(NOTE, 900).likes).toBe(1) // '3…' gone, '1…' stands
  })
})
