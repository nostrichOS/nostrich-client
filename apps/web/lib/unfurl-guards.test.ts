import { describe, expect, it } from 'vitest'

import { isBareHost, looksLikeChallenge } from './server/unfurl-guards'

/** Things a link card must never do, pinned as pure functions. */

describe('a title that is only the domain', () => {
  const wsj = new URL('https://www.wsj.com/arts-culture/books/five-best-books')

  it('is recognised, in the shapes a block page actually serves', () => {
    expect(isBareHost('wsj.com', wsj)).toBe(true)
    expect(isBareHost('WSJ.com', wsj)).toBe(true)
    expect(isBareHost(' www.wsj.com ', wsj)).toBe(true)
    expect(isBareHost('wsj.com/', wsj)).toBe(true)
  })

  it('leaves a real headline alone, including one that names the site', () => {
    expect(isBareHost('Five Best Books on the Human Side of Science', wsj)).toBe(false)
    expect(isBareHost('WSJ News Exclusive: something happened', wsj)).toBe(false)
    expect(isBareHost(undefined, wsj)).toBe(false)
  })
})

describe('a page that is a wall rather than the page', () => {
  it('recognises the interstitial by its title', () => {
    // lemonde.fr, verbatim: HTTP 200, a valid document, a title that is not an article.
    expect(looksLikeChallenge('<html><head><title>Client Challenge</title></head>', 'Client Challenge')).toBe(true)
    expect(looksLikeChallenge('', 'Just a moment...')).toBe(true)
    expect(looksLikeChallenge('', 'Attention Required! | Cloudflare')).toBe(true)
    expect(looksLikeChallenge('', 'Access to this page has been denied')).toBe(true)
    expect(looksLikeChallenge('', 'Pardon Our Interruption')).toBe(true)
    expect(looksLikeChallenge('', 'Request unsuccessful. Incapsula incident ID: 123')).toBe(true)
  })

  it('recognises the vendor by its own asset paths', () => {
    // What actually came back from lemonde.fr: an F5 Shape challenge, whose assets say.
    expect(looksLikeChallenge('<link href="/_fs-ch-1T1wmsGaOgGaSxcX/assets/styles.css">', undefined)).toBe(true)
    // The same marker, on a document with nothing to share: that IS the wall.
    expect(looksLikeChallenge('<script src="/cdn-cgi/challenge-platform/h/b/orchestrate">', 'Loading')).toBe(true)
  })

  it('does not mistake a page PROTECTED by a wall for the wall itself', () => {
    /* news.artnet.com, verbatim: an ordinary Cloudflare-served article whose head loads. */
    const artnet =
      '<html><head><meta property="og:title" content="Exhibitors Demand Gwangju Biennale Reinstate Taiwan Pavilion">' +
      '<meta property="og:image" content="https://p-news-upload.storage.googleapis.com/2023/04/IMG_7176-scaled.jpg">' +
      '<script src="/cdn-cgi/challenge-platform/scripts/precursor/main.js"></script></head>'
    expect(looksLikeChallenge(artnet, 'Exhibitors Demand Gwangju Biennale Reinstate Taiwan Pavilion')).toBe(false)
  })

  it('leaves a real article alone, including one written about these walls', () => {
    expect(
      looksLikeChallenge(
        '<html><head><title>Cloudflare outage takes down half the web</title></head>',
        'Cloudflare outage takes down half the web',
      ),
    ).toBe(false)
    // A comment form that loads reCAPTCHA is not a wall.
    expect(
      looksLikeChallenge('<script src="https://www.google.com/recaptcha/api.js"></script>', 'How to bake bread'),
    ).toBe(false)
    expect(looksLikeChallenge('', undefined)).toBe(false)
    expect(looksLikeChallenge('', '')).toBe(false)
  })
})
