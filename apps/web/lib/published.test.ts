import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import { announcePublished, announceRetracted, onPublished, onRetracted } from './published'

/** A composer shows a note the moment it is signed. */

const note = (id: string): NostrEvent =>
  ({ id, pubkey: 'a'.repeat(64), kind: 1, created_at: 1, tags: [], content: '', sig: '' }) as NostrEvent

describe('announce and retract', () => {
  it('tells every listener about a published note', () => {
    const seen: string[] = []
    const off = onPublished(event => seen.push(event.id))
    announcePublished(note('abc'))
    off()
    expect(seen).toEqual(['abc'])
  })

  it('tells every listener when one is taken back', () => {
    const gone: string[] = []
    const off = onRetracted(id => gone.push(id))
    announceRetracted('abc')
    off()
    expect(gone).toEqual(['abc'])
  })

  it('keeps the two channels apart, so a retraction is never read as a publish', () => {
    const published = vi.fn()
    const retracted = vi.fn()
    const offA = onPublished(published)
    const offB = onRetracted(retracted)
    announceRetracted('abc')
    expect(published).not.toHaveBeenCalled()
    expect(retracted).toHaveBeenCalledOnce()
    offA()
    offB()
  })

  it('stops delivering once a listener unsubscribes', () => {
    const seen: string[] = []
    const off = onRetracted(id => seen.push(id))
    off()
    announceRetracted('abc')
    expect(seen).toEqual([])
  })

  it('reaches several listeners at once, a thread and a feed may both be showing it', () => {
    const a: string[] = []
    const b: string[] = []
    const offA = onRetracted(id => a.push(id))
    const offB = onRetracted(id => b.push(id))
    announceRetracted('abc')
    offA()
    offB()
    expect([a, b]).toEqual([['abc'], ['abc']])
  })
})

describe('every composer reaches the shared rail', () => {
  const composer = readFileSync(join(__dirname, '..', 'components', 'Composer.tsx'), 'utf8')
  const modal = readFileSync(join(__dirname, '..', 'components', 'ComposeModal.tsx'), 'utf8')

  it('announces from the composer, not from each host', () => {
    /* `onPublished` is the HOST's hook. */
    expect(composer).toContain('announcePublished(signed)')
  })

  it('announces exactly once', () => {
    // Both dedupe by id, so a double is harmless.
    expect(modal).not.toContain('announcePublished(')
  })
})
