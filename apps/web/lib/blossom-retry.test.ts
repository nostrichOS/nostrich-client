import { describe, expect, it } from 'vitest'

import { nextCandidate } from './blossom-retry'

/** THE FALLBACK WALK MUST SURVIVE ITS OWN CHAIN CHANGING. */

const NAMED = 'https://cdn.azzamo.net/901e78c6.png'
const NOSTR_BUILD = 'https://blossom.nostr.build/901e78c6.png'
const HZRD = 'https://cdn.hzrd149.com/901e78c6.png'
const NOSTRCHECK = 'https://cdn.nostrcheck.me/901e78c6.png'
const CDN_B = 'https://cdn-b.example/901e78c6.png'
const AZZAMO_MEDIA = 'https://blossom.azzamo.media/901e78c6.png'

describe('nextCandidate', () => {
  it('starts at the url the article actually named', () => {
    expect(nextCandidate([NAMED, NOSTR_BUILD, HZRD], [])).toBe(NAMED)
  })

  it('walks past every copy that has already failed', () => {
    expect(nextCandidate([NAMED, NOSTR_BUILD, HZRD], [NAMED, NOSTR_BUILD])).toBe(HZRD)
  })

  it('picks up a copy spliced in at the FRONT after the walk began', () => {
    // The regression, exactly: our three defaults are exhausted, then the author's.
    const tried = [NAMED, NOSTR_BUILD, HZRD, NOSTRCHECK]
    const grown = [CDN_B, AZZAMO_MEDIA, NAMED, NOSTR_BUILD, HZRD, NOSTRCHECK]
    expect(nextCandidate(grown, tried)).toBe(CDN_B)
    expect(nextCandidate(grown, [...tried, CDN_B])).toBe(AZZAMO_MEDIA)
  })

  it('is unmoved by a demoted host being shuffled to the back', () => {
    // `reorderByHealth` is a partition, so the same candidates come back in a different.
    const before = [NAMED, CDN_B, AZZAMO_MEDIA]
    const after = [CDN_B, AZZAMO_MEDIA, NAMED]
    expect(nextCandidate(before, [NAMED])).toBe(CDN_B)
    expect(nextCandidate(after, [NAMED])).toBe(CDN_B)
  })

  it('reports nothing left only when every candidate has been tried', () => {
    expect(nextCandidate([NAMED, NOSTR_BUILD], [NAMED, NOSTR_BUILD])).toBeUndefined()
    // An empty chain is a url we cannot mirror at all.
    expect(nextCandidate([], [])).toBeUndefined()
  })
})
