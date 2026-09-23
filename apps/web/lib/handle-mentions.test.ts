import { beforeEach, describe, expect, it } from 'vitest'

import { linkifyHandles, resolveHandle } from './handle-mentions'
import { writeCachedProfile } from './profile-cache'

/** `@btcframe` in a bio is not a mention. */

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const CAROL = 'c'.repeat(64)

/* A DISTINCT HANDLE PER TEST. */
beforeEach(() => {
  localStorage.clear()
})

/* `writeCachedProfile` stores nothing for a profile with only a NIP-05. */
function cache(pubkey: string, fields: { name?: string; displayName?: string; nip05?: string }): void {
  const filler = fields.name === undefined && fields.displayName === undefined ? { name: 'unrelated-filler' } : {}
  writeCachedProfile(pubkey as never, { pubkey, updatedAt: 1, ...filler, ...fields } as never)
}

describe('resolveHandle', () => {
  it('resolves a handle exactly one known account answers to', () => {
    cache(ALICE, { name: 'uniquehandleone' })
    expect(resolveHandle('uniquehandleone')).toBe(ALICE)
  })

  it('ignores case, the way people type names', () => {
    cache(ALICE, { name: 'MixedCaseTwo' })
    expect(resolveHandle('mixedcasetwo')).toBe(ALICE)
  })

  it('matches a display name or a NIP-05 local part too', () => {
    cache(ALICE, { displayName: 'displaythree' })
    cache(BOB, { nip05: 'nipfour@finney.org' })
    expect(resolveHandle('displaythree')).toBe(ALICE)
    expect(resolveHandle('nipfour')).toBe(BOB)
  })

  /** THE ONE THAT MATTERS. */
  it('refuses when more than one known account claims the handle', () => {
    cache(ALICE, { name: 'sharedfive' })
    cache(BOB, { name: 'sharedfive' })
    expect(resolveHandle('sharedfive')).toBeUndefined()
  })

  it('refuses a prefix, so @bit never becomes the first bitcoiner in the cache', () => {
    cache(ALICE, { name: 'bitcoinersix' })
    expect(resolveHandle('bit')).toBeUndefined()
  })

  it('refuses a handle nobody here knows, rather than searching the network', () => {
    expect(resolveHandle('stranger')).toBeUndefined()
  })

  it('refuses an empty handle', () => {
    expect(resolveHandle('')).toBeUndefined()
    expect(resolveHandle('   ')).toBeUndefined()
  })
})

describe('linkifyHandles', () => {
  it('rewrites a resolvable handle into a real mention', () => {
    cache(ALICE, { name: 'linkseven' })
    const out = linkifyHandles('dev @linkseven, running #bitcoin. building https://nostrich.org')
    expect(out).toMatch(/^dev nostr:npub1/)
    expect(out).toContain('#bitcoin')
    expect(out).toContain('https://nostrich.org')
    expect(out).not.toContain('@linkseven')
  })

  it('leaves an unresolvable handle exactly as written', () => {
    const bio = 'dev @nobodyknowsthiseight, running #bitcoin'
    expect(linkifyHandles(bio)).toBe(bio)
  })

  it('leaves an ambiguous handle alone rather than picking one', () => {
    cache(ALICE, { name: 'twinsnine' })
    cache(BOB, { name: 'twinsnine' })
    expect(linkifyHandles('hello @twinsnine')).toBe('hello @twinsnine')
  })

  it('does not touch an email address, which is not a mention', () => {
    cache(ALICE, { name: 'supportten' })
    // The `@` here belongs to the address.
    const bio = 'write to me@example.com'
    expect(linkifyHandles(bio)).toBe(bio)
  })

  it('rewrites several handles in one bio, independently', () => {
    cache(ALICE, { name: 'aliceeleven' })
    cache(CAROL, { name: 'caroltwelve' })
    const out = linkifyHandles('@aliceeleven and @nobodyhere and @caroltwelve')
    expect(out.match(/nostr:npub1/g)).toHaveLength(2)
    expect(out).toContain('@nobodyhere')
  })

  it('leaves a bio with no handles untouched', () => {
    const bio = 'Nostrich is a new, 100% free Nostr client. Your content. Your feed.'
    expect(linkifyHandles(bio)).toBe(bio)
  })
})
