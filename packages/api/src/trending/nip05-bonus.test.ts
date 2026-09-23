import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { NIP05_BONUS, rejectionFor } from './build'
import type { NostrEvent } from '@nostrich/nostr'

/** NIP-05 stopped being a gate and became evidence. */
const build = readFileSync(join(__dirname, 'build.ts'), 'utf8')
const builder = readFileSync(join(__dirname, 'builder.ts'), 'utf8')

const event = (pubkey: string): NostrEvent =>
  // Not a greeting: "hello" on its own is refused by `isGreetingOnly`, which is correct.
  ({
    id: 'a'.repeat(64), kind: 1, pubkey, created_at: 1,
    content: 'A note with something in it worth reading.', tags: [], sig: '',
  }) as NostrEvent

const PIC = 'https://example.com/a.png'

const entry = (pubkey = 'b'.repeat(64)) => ({
  id: 'a'.repeat(64),
  event: event(pubkey),
  counts: { replies: 1, reposts: 0, quotes: 0, reactions: 1, zapCount: 0, zapSats: 0 },
  sources: ['wine'],
}) as never

describe('a missing NIP-05 no longer rejects', () => {
  it('keeps a note whose author has none', () => {
    const reason = rejectionFor(entry(), {
      profileOf: () => ({ name: 'Somebody', displayName: 'Somebody', picture: PIC }) as never,
    })
    expect(reason).toBeUndefined()
  })

  it('still requires a profile and a name', () => {
    // The rules that cost something to defeat are untouched.
    expect(rejectionFor(entry(), { profileOf: () => undefined })).toBe('no-profile')
    expect(rejectionFor(entry(), { profileOf: () => ({ name: '  ', picture: PIC }) as never })).toBe('no-name')
  })
})

describe('a verified NIP-05 earns points', () => {
  it('is worth five', () => {
    // A zap is worth 3 and a reply 2 in `engagementScore`: enough to lift a verified.
    expect(NIP05_BONUS).toBe(5)
  })

  it('is added to the score rather than gating the note', () => {
    expect(build).toContain('(nip05Verified.has(event.pubkey as Hex) ? NIP05_BONUS : 0)')
  })

  it('is VERIFIED, not claimed, the whole point of the change', () => {
    expect(builder).toContain('await verifyNip05(claim, pubkey,')
  })

  it('caches answers, including failures', () => {
    // Four windows rebuilding every five minutes would otherwise hammer other people's.
    expect(builder).toContain('const NIP05_TTL_MS = 24 * 60 * 60_000')
    expect(builder).toContain('nip05Cache.set(pubkey, { verified, at: Date.now(), claim })')
  })

  it('re-checks when the claim itself changes', () => {
    expect(builder).toContain("held.claim === claim")
  })

  it('never lets a slow domain hold up a build', () => {
    expect(builder).toContain('NIP05_TIMEOUT_MS')
    expect(builder).toContain('.catch(\n    () => new Set<Hex>(),\n  )')
  })
})
