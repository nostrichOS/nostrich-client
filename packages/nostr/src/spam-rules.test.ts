import { describe, expect, it } from 'vitest'

import type { Hex } from './types'

import {
  advertisesCampaignDomain,
  isBlockedFromDiscovery,
  isExcludedFromTrending,
  isSuppressed,
} from './spam-rules'

/** THE LIST IS THE HAZARD, NOT THE MATCHER. */
describe('the campaign-domain list', () => {
  /** A domain thousands of ordinary accounts advertise, whatever one of them is doing. */
  const PLATFORMS = [
    'substack.com', 'medium.com', 'ghost.io', 'wordpress.com', 'notion.site',
    'github.com', 'github.io', 'gitlab.com', 'pages.dev', 'netlify.app', 'vercel.app',
    'linktr.ee', 'bento.me', 'beacons.ai', 'bit.ly', 't.co', 'tinyurl.com',
    'youtube.com', 'rumble.com', 't.me', 'x.com', 'mastodon.social', 'mostr.pub',
    'nostr.build', 'example-client.test', 'example-client.test', 'example-client.test', 'njump.me', 'nostrcheck.me',
    'nostrplebs.com', 'zap.stream', 'fountain.fm', 'stacker.news', 'nostrich.org',
  ]

  it('never condemns an account for advertising a platform', () => {
    for (const domain of PLATFORMS) {
      expect(advertisesCampaignDomain({ website: `https://${domain}/alice` }), domain).toBe(false)
      expect(advertisesCampaignDomain({ nip05: `alice@${domain}` }), domain).toBe(false)
      expect(advertisesCampaignDomain({ banner: `https://${domain}/banner.jpg` }), domain).toBe(false)
    }
  })

  it('reads the three fields where an account claims a site as its own', () => {
    expect(advertisesCampaignDomain({ website: 'https://example-campaign.test' })).toBe(true)
    expect(advertisesCampaignDomain({ website: 'https://WWW.Example-Campaign.Test/x' })).toBe(true)
    expect(advertisesCampaignDomain({ banner: 'https://example-campaign.test/og.png?v=2' })).toBe(true)
    expect(advertisesCampaignDomain({ nip05: 'anna@example-campaign.test' })).toBe(true)
    // Bare-domain NIP-05 shorthand.
    expect(advertisesCampaignDomain({ nip05: 'example-campaign.test' })).toBe(true)
    expect(advertisesCampaignDomain({ website: 'https://cdn.example-campaign.test/x' })).toBe(true)
  })

  /** Host-or-subdomain, never substring. */
  it('does not match a domain that merely contains a listed one', () => {
    expect(advertisesCampaignDomain({ website: 'https://notexample-campaign.test' })).toBe(false)
    expect(advertisesCampaignDomain({ website: 'https://example-campaign.test.evil.example' })).toBe(false)
  })

  /** The bio is NOT a claim of ownership. */
  it('never reads the bio, whatever it says', () => {
    expect(advertisesCampaignDomain({ website: 'https://zapstore.dev' })).toBe(false)
    // `about` is not even in the accepted shape.
    expect(advertisesCampaignDomain({ about: 'example-campaign.test is slop' } as never)).toBe(false)
  })

  it('has no opinion without a profile', () => {
    expect(advertisesCampaignDomain(undefined)).toBe(false)
    expect(advertisesCampaignDomain(null)).toBe(false)
    expect(advertisesCampaignDomain({})).toBe(false)
    // Absence is never evidence: no NIP-05 and no site is an ordinary new account.
    expect(advertisesCampaignDomain({ website: '', banner: '', nip05: '' })).toBe(false)
  })
})

/** The charts-only list, and the one thing that must stay true. */
describe('the charts-only exclusion list', () => {
  /** The synthetic entry seeded in `NOT_TRENDING`. */
  const FLASH = ('1'.repeat(64)) as Hex
  const ORDINARY = 'b'.repeat(64) as Hex

  it('excludes a listed account from the charts', () => {
    expect(isExcludedFromTrending(FLASH)).toBe(true)
  })

  it('has no opinion about anybody else', () => {
    expect(isExcludedFromTrending(ORDINARY)).toBe(false)
  })

  /** THE WHOLE POINT. */
  it('does not hide a listed account from anything else', () => {
    expect(isBlockedFromDiscovery(FLASH)).toBe(false)
    expect(isSuppressed(FLASH)).toBe(false)
  })

  /** And not the other way round either. */
  it('does not answer for the blocklist', () => {
    const blocked = ('2'.repeat(64)) as Hex
    expect(isBlockedFromDiscovery(blocked)).toBe(true)
    expect(isExcludedFromTrending(blocked)).toBe(false)
  })
})

/** A key list cannot win against free key generation, so an operation. */
describe('a campaign matched by its domain', () => {
  it('catches a key nobody has listed yet, which is the whole point', () => {
    expect(advertisesCampaignDomain({ nip05: 'somebodynew@example-campaign.test' })).toBe(true)
  })

  it('does not reach past the domain', () => {
    expect(advertisesCampaignDomain({ website: 'https://notexample-campaign.test' })).toBe(false)
    expect(advertisesCampaignDomain({ website: 'https://example-campaign.test.evil.example' })).toBe(false)
  })
})
