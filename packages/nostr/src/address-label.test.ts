import { describe, expect, it } from 'vitest'

import { addressLabel } from './address-label'

/** The string a reader sees when an `naddr` cannot be resolved. */

const stream = (identifier: string, bech32 = 'naddr1qqjxvvfn8yukyde4943nwcnz956rye3k9'): {
  kind: number
  identifier: string
  bech32: string
} => ({ kind: 30311, identifier, bech32 })

describe('addressLabel', () => {
  it('names a live stream by its kind, not its UUID', () => {
    // Every kind-30311 `d` measured on five relays was a 36-character UUID: unreadable.
    expect(addressLabel(stream('f1399b75-c7bb-42f6-a4fc-dceef8344e0b'))).toBe('Live stream')
  })

  it('never renders two different streams as the same bech32 prefix', () => {
    /* THE REGRESSION THIS FILE EXISTS. */
    const a = addressLabel(stream('11111111-1111-1111-1111-111111111111', 'naddr1qqjxvvfnAAAA'))
    const b = addressLabel(stream('22222222-2222-2222-2222-222222222222', 'naddr1qqjxvvfnBBBB'))
    expect(a.startsWith('naddr1')).toBe(false)
    expect(b.startsWith('naddr1')).toBe(false)
  })

  it('shows an article slug, which a person actually chose', () => {
    expect(addressLabel({ kind: 30023, identifier: 'why-nostr-matters', bech32: 'naddr1x' })).toBe(
      'why-nostr-matters',
    )
  })

  it('falls back to the kind when even a person-chosen identifier is missing', () => {
    expect(addressLabel({ kind: 30023, identifier: '', bech32: 'naddr1x' })).toBe('Article')
    expect(addressLabel({ kind: 30402, identifier: '', bech32: 'naddr1x' })).toBe('Listing')
    expect(addressLabel({ kind: 30001, identifier: '', bech32: 'naddr1x' })).toBe('List')
  })

  it('treats whitespace as no identifier', () => {
    // A `d` tag of spaces is not a name, and rendering one is a label the reader cannot.
    expect(addressLabel({ kind: 30023, identifier: '   ', bech32: 'naddr1x' })).toBe('Article')
  })

  it('falls back to the pointer only for an unknown kind with no identifier', () => {
    expect(addressLabel({ kind: 31337, identifier: '', bech32: 'naddr1qqjxvvfn8yuk' })).toBe(
      'naddr1qqjxvvfn…',
    )
    expect(addressLabel({ kind: 31337, identifier: 'my-thing', bech32: 'naddr1qqjxvvfn8yuk' })).toBe(
      'my-thing',
    )
  })
})
