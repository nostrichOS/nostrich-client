import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { rejectionFor } from './build'
import type { NostrEvent, Profile } from '@nostrich/nostr'

/** NO PICTURE, NO CHART. */
const build = readFileSync(join(__dirname, 'build.ts'), 'utf8')

const event = (): NostrEvent =>
  ({
    id: 'a'.repeat(64), kind: 1, pubkey: 'b'.repeat(64), created_at: 1,
    // Not a greeting.
    content: 'A note with something in it worth reading.', tags: [], sig: '',
  }) as NostrEvent

const entry = () => ({
  id: 'a'.repeat(64),
  event: event(),
  counts: { replies: 3, reposts: 0, quotes: 0, reactions: 1, zapCount: 0, zapSats: 0 },
  sources: ['wine'],
}) as never

const judge = (profile: Profile) => rejectionFor(entry(), { profileOf: () => profile })

describe('an author with no picture is not promoted', () => {
  it('rejects a profile with no picture field at all', () => {
    expect(judge({ name: 'Паладин' } as Profile)).toBe('no-picture')
  })

  it('rejects an empty string, which is what a cleared field leaves behind', () => {
    expect(judge({ name: 'Паладин', picture: '' } as Profile)).toBe('no-picture')
  })

  it('rejects whitespace, the same trim the name check uses', () => {
    expect(judge({ name: 'Паладин', picture: '   ' } as Profile)).toBe('no-picture')
  })

  it('keeps an author who has one, with no NIP-05 anywhere in sight', () => {
    // The rule that replaced the NIP-05 gate must not quietly become a NIP-05 gate again.
    expect(judge({ name: 'Паладин', picture: 'https://example.com/p.png' } as Profile)).toBeUndefined()
  })
})

describe('it does not shadow the narrower rules above it', () => {
  /* The ordering trap this file exists to pin down, and the same one `campaign-domain`. */
  it('still answers no-profile before anything about a picture', () => {
    expect(rejectionFor(entry(), { profileOf: () => undefined })).toBe('no-profile')
  })

  it('still answers no-name for a nameless, pictureless author', () => {
    expect(judge({ picture: '' } as Profile)).toBe('no-name')
  })

  it('still answers adult-name, which sits above it', () => {
    expect(judge({ name: 'XXX Cam Girls' } as Profile)).toBe('adult-name')
  })

  it('still answers campaign-domain, which sits above it', () => {
    expect(judge({ name: 'Example Persona', website: 'https://example-campaign.test' } as Profile))
      .toBe('campaign-domain')
  })

  it('is asked after every profile rule in the source, not merely in these cases', () => {
    // The assertions above prove the order for four inputs.
    const at = (needle: string) => build.indexOf(needle)
    expect(at("return 'no-picture'")).toBeGreaterThan(at("return 'no-name'"))
    expect(at("return 'no-picture'")).toBeGreaterThan(at("return 'adult-name'"))
    expect(at("return 'no-picture'")).toBeGreaterThan(at("return 'campaign-domain'"))
    expect(at("return 'no-picture'")).toBeGreaterThan(at("return 'phishing'"))
  })
})
