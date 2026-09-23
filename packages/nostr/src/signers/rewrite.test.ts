import { describe, expect, it } from 'vitest'

import { templateMismatch } from './rewrite'
import type { EventTemplate, NostrEvent } from '../types'

/** Proving the signer signed what it was handed. */

const template: EventTemplate = {
  kind: 1,
  created_at: 1_787_000_000,
  tags: [
    ['e', 'a'.repeat(64), '', 'root'],
    ['p', 'b'.repeat(64)],
  ],
  content: 'try nostr:npub17fe5rak works pretty well',
}

const signedFrom = (over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: 'c'.repeat(64),
    pubkey: 'd'.repeat(64),
    sig: 'e'.repeat(128),
    kind: template.kind,
    created_at: template.created_at,
    tags: template.tags,
    content: template.content,
    ...over,
  }) as NostrEvent

describe('templateMismatch', () => {
  it('passes an event that came back unchanged', () => {
    expect(templateMismatch(template, signedFrom())).toBeUndefined()
  })

  it('catches altered text', () => {
    const changed = templateMismatch(template, signedFrom({ content: 'try https://example.com' }))
    expect(changed?.field).toBe('content')
  })

  it('catches a dropped tag', () => {
    const changed = templateMismatch(template, signedFrom({ tags: [['e', 'a'.repeat(64), '', 'root']] }))
    expect(changed?.field).toBe('tags')
  })

  it('catches an added tag, a mention nobody asked for', () => {
    const changed = templateMismatch(
      template,
      signedFrom({ tags: [...template.tags, ['p', 'f'.repeat(64)]] }),
    )
    expect(changed?.field).toBe('tags')
  })

  it('catches a changed kind', () => {
    expect(templateMismatch(template, signedFrom({ kind: 6 }))?.field).toBe('kind')
  })

  it('ignores the timestamp entirely, including a two-day backdate', () => {
    /* NOT an oversight. */
    expect(templateMismatch(template, signedFrom({ created_at: template.created_at + 45 }))).toBeUndefined()
    expect(
      templateMismatch(template, signedFrom({ created_at: template.created_at - 2 * 86_400 })),
    ).toBeUndefined()
  })

  it('treats a missing tags array as a mismatch rather than throwing', () => {
    expect(() => templateMismatch(template, signedFrom({ tags: undefined as never }))).not.toThrow()
    expect(templateMismatch(template, signedFrom({ tags: undefined as never }))?.field).toBe('tags')
  })
})
