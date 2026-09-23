import { describe, expect, it } from 'vitest'

import { resolveTab, tabFromParam } from './feed-tab'

/** Which feed a reader lands. */

const base = { requested: null, signedIn: false, customMissing: false, hasFollows: false } as const
const tab = (over: Partial<Parameters<typeof resolveTab>[0]> = {}) => resolveTab({ ...base, ...over })

describe('resolveTab', () => {
  describe('a reader who has not asked for anything', () => {
    it('SIGNED OUT lands on Trending', () => {
      // The rule this file exists.
      expect(tab()).toBe('trending')
    })

    it('signed in with a contact list lands on Following', () => {
      expect(tab({ signedIn: true, hasFollows: true })).toBe('follows')
    })

    it('signed in following NOBODY lands on Trending, not the firehose', () => {
      /* A brand-new account: key created three screens ago, follow packs skipped. */
      expect(tab({ signedIn: true, hasFollows: false })).toBe('trending')
    })

    it('holds Following while the contact list is still loading', () => {
      // `hasFollows` is true while loading precisely so this cannot fall.
      expect(tab({ signedIn: true, hasFollows: true })).toBe('follows')
    })
  })

  describe('an explicit request always wins', () => {
    it.each(['latest', 'trending'] as const)('honours ?feed=%s when signed out', (requested) => {
      // The default decides where somebody LANDS, never where they are allowed to go.
      expect(tab({ requested })).toBe(requested)
    })

    it.each(['latest', 'trending', 'follows'] as const)('honours ?feed=%s when signed in', (requested) => {
      expect(tab({ requested, signedIn: true, hasFollows: true })).toBe(requested)
    })
  })

  describe('requests that cannot be served', () => {
    it('sends a signed-out reader asking for Following to Trending', () => {
      // There is no follow list without a key.
      expect(tab({ requested: 'follows' })).toBe('trending')
    })

    it('sends a signed-in reader with a missing custom feed to Latest', () => {
      // With a contact list they have a timeline, so Latest is a lens rather than a front.
      expect(tab({ requested: 'custom', customMissing: true, signedIn: true, hasFollows: true })).toBe('latest')
    })

    it('sends one who follows nobody to Trending instead', () => {
      expect(tab({ requested: 'custom', customMissing: true, signedIn: true, hasFollows: false })).toBe('trending')
    })

    it('sends a signed-OUT reader with a missing custom feed to Trending', () => {
      // A link pasted from another browser, or a feed just deleted.
      expect(tab({ requested: 'custom', customMissing: true })).toBe('trending')
    })

    it('serves a custom feed that IS present', () => {
      expect(tab({ requested: 'custom', customMissing: false })).toBe('custom')
    })
  })

  it('never returns follows for a reader with no key, whatever else is true', () => {
    for (const requested of [null, 'follows', 'latest', 'trending', 'custom'] as const) {
      for (const customMissing of [true, false]) {
        for (const hasFollows of [true, false]) {
          expect(tab({ requested, customMissing, hasFollows })).not.toBe('follows')
        }
      }
    }
  })
})

describe('tabFromParam, the app\'s public URL vocabulary', () => {
  it.each([
    ['follows', 'follows'],
    ['trending', 'trending'],
    ['custom', 'custom'],
    ['latest', 'latest'],
  ] as const)('reads ?feed=%s', (raw, expected) => {
    expect(tabFromParam(raw)).toBe(expected)
  })

  it('still honours "following", the first release\'s spelling', () => {
    // Links to it exist in the wild and cost nothing to keep working.
    expect(tabFromParam('following')).toBe('follows')
  })

  it.each(['verified', 'discover', 'global'])('folds the retired %s feed into Latest', (raw) => {
    // All three shipped at some point.
    expect(tabFromParam(raw)).toBe('latest')
  })

  it.each([null, '', 'Latest', 'TRENDING', 'nonsense', '../etc/passwd'])(
    'returns null for %s, so the default decides',
    (raw) => {
      expect(tabFromParam(raw)).toBeNull()
    },
  )

  it('is case sensitive, so a bad link falls to the default rather than half-working', () => {
    expect(tabFromParam('Trending')).toBeNull()
  })
})
