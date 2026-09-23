import { beforeEach, describe, expect, it } from 'vitest'
import type { Hex, NostrEvent, Profile } from '@nostrich/nostr'

import { forgetCachedProfile, readCachedProfile, writeCachedProfile } from './profile-cache'
import { advertisingReply } from './trust'

/** The rule fires on the CLIENT, not only on the server. */

const KEY = 'd75fbecd3a3a149a3784b4b9143509e5abdd5d1a097815ef68cfda7e4e1a32f0' as Hex

const reply = (content: string): NostrEvent =>
  ({
    id: '0'.repeat(64),
    pubkey: KEY,
    kind: 1,
    created_at: 1_700_000_000,
    content,
    tags: [['e', '1'.repeat(64), '', 'root']],
    sig: '',
  }) as NostrEvent

beforeEach(() => {
  forgetCachedProfile(KEY)
})

describe('advertisingReply', () => {
  it('reads the advertised site back out of the profile cache', () => {
    // The regression test proper: without `website` stored, this returns undefined.
    writeCachedProfile(KEY, {
      pubkey: KEY,
      name: 'EXPERT-PRIYA-SHARMA-001',
      website: 'https://example-campaign.test',
    } as Profile)
    expect(readCachedProfile(KEY)?.profile.website).toBe('https://example-campaign.test')
  })

  it('catches the reply that prompted it', () => {
    writeCachedProfile(KEY, {
      pubkey: KEY,
      name: 'EXPERT-PRIYA-SHARMA-001',
      website: 'https://example-campaign.test',
    } as Profile)
    expect(
      advertisingReply(
        reply(
          'Nice UX improvement for relay management – reminds me of a piece I read.\n\n' +
            'https://example-campaign.test/articles/russia-evacuating-bushehr-nuclear-escalation',
        ),
      ),
    ).toBe(true)
  })

  it('leaves an ordinary reply from the same account alone', () => {
    writeCachedProfile(KEY, {
      pubkey: KEY,
      name: 'EXPERT-PRIYA-SHARMA-001',
      website: 'https://example-campaign.test',
    } as Profile)
    expect(advertisingReply(reply('Genuinely nice work on the relay screen.'))).toBe(false)
  })

  it('has no opinion when the author is not in the cache at all', () => {
    // Fail open.
    expect(advertisingReply(reply('https://example-campaign.test/x'))).toBe(false)
  })
})
