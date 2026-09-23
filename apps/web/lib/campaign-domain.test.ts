import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Hex, NostrEvent, Profile } from '@nostrich/nostr'

/** THE CAMPAIGN-DOMAIN RULE, from the browser's side. */

const hex = (seed: string): Hex => seed.repeat(64).slice(0, 64) as Hex

const PERSONA = hex('3e')
const WARNER = hex('7a')

function note(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '11'.repeat(32),
    pubkey: PERSONA,
    created_at: 1_800_000_000,
    kind: 1,
    tags: [],
    content: 'hello',
    sig: '0'.repeat(128),
    ...overrides,
  }
}

/** The cache is read once at module evaluation, so the modules have to be loaded fresh. */
async function load(): Promise<{
  isCampaignAccount: (pubkey: Hex) => boolean
  isTagSpam: (event: NostrEvent) => boolean
  write: (pubkey: Hex, profile: Partial<Profile>) => void
  forget: (pubkey: Hex) => void
}> {
  vi.resetModules()
  const cache = await import('./profile-cache')
  const spam = await import('./spam')
  return {
    isCampaignAccount: spam.isCampaignAccount,
    isTagSpam: spam.isTagSpam,
    // A profile with nothing paintable is not stored at all, so every fixture carries.
    write: (pubkey, profile) =>
      cache.writeCachedProfile(pubkey, { pubkey, updatedAt: 1, name: 'Anna', ...profile } as Profile),
    forget: cache.forgetCachedProfile,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('the campaign-domain rule', () => {
  it('catches an account that claims the domain in any of the three fields', async () => {
    for (const claim of [
      { website: 'https://example-campaign.test' },
      { banner: 'https://example-campaign.test/static/og-default.png?v=2' },
      { nip05: 'anna@example-campaign.test' },
      // The bare-domain NIP-05 shorthand, meaning `_@example-campaign.test`.
      { nip05: 'example-campaign.test' },
      // A subdomain is the same site.
      { website: 'https://cdn.example-campaign.test/x' },
    ]) {
      const { isCampaignAccount, write } = await load()
      write(PERSONA, claim)
      expect(isCampaignAccount(PERSONA), JSON.stringify(claim)).toBe(true)
    }
  })

  /** THE WARNER, and the whole reason the bio is not read. */
  it('leaves alone everybody who writes about the campaign rather than for it', async () => {
    for (const innocent of [
      { about: 'Tracking AI slop on nostr: example-campaign.test, DM me sightings' },
      { about: 'example-campaign.test is a content farm, do not trust it', website: 'https://zapstore.dev/' },
      { website: 'https://web.archive.org/web/2026/https://example-campaign.test/x' },
      // Denying it must not match it, which is what a substring verdict would do.
      { website: 'https://notexample-campaign.test' },
    ]) {
      const { isCampaignAccount, isTagSpam, write } = await load()
      write(WARNER, innocent)
      expect(isCampaignAccount(WARNER), JSON.stringify(innocent)).toBe(false)
      // And the note itself, which links the domain.
      expect(
        isTagSpam(note({ pubkey: WARNER, content: 'heads up https://example-campaign.test/x is slop' })),
      ).toBe(false)
    }
  })

  it('drops a root note from a persona, which is the hole the reply rule could not reach', async () => {
    const { isTagSpam, write } = await load()
    write(PERSONA, { website: 'https://example-campaign.test' })
    // No `e` tag: `selfPromotingReply` returns false on its first line for this, by design.
    const root = note({ content: 'The Bottleneck Nobody is Pricing https://example-campaign.test/articles/x' })
    expect(root.tags).toHaveLength(0)
    expect(isTagSpam(root)).toBe(true)
  })

  /** A cache miss is NO EVIDENCE, and the fail-open direction is deliberate: an account. */
  it('says nothing about an account whose profile is not cached', async () => {
    const { isCampaignAccount, isTagSpam, write, forget } = await load()
    write(PERSONA, { website: 'https://example-campaign.test' })
    expect(isCampaignAccount(PERSONA)).toBe(true)
    forget(PERSONA)
    expect(isCampaignAccount(PERSONA)).toBe(false)
    expect(isTagSpam(note({ content: 'https://example-campaign.test/x' }))).toBe(false)
  })

  it('says nothing about an ordinary account with an ordinary site', async () => {
    const { isCampaignAccount, write } = await load()
    write(WARNER, { website: 'https://example.com', banner: 'https://nostr.build/x.jpg', nip05: 'a@example.com' })
    expect(isCampaignAccount(WARNER)).toBe(false)
  })
})
