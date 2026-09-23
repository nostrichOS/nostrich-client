import { naddrEncode, neventEncode, noteEncode, npubEncode } from 'nostr-tools/nip19'
import { describe, expect, it } from 'vitest'

import { BODY_LIMIT, hashtagsFromContent, linkRanges, parseContent, referencesFromContent, splitMedia, truncateSegments } from './content'
import { mergeProfiles, parseProfile, pickLatestMetadata, profileDisplayName, profileToTemplate } from './profile'
import type { NostrEvent, Profile } from './types'

const ALICE = 'a1'.repeat(32)
const NOTE = 'b2'.repeat(32)

const npub = npubEncode(ALICE)
const note = noteEncode(NOTE)

describe('parseContent ordering', () => {
  it('keeps a fragment inside the url instead of splitting off a hashtag', () => {
    expect(parseContent('read https://example.com/page#section now')).toEqual([
      { type: 'text', value: 'read ' },
      { type: 'url', url: 'https://example.com/page#section' },
      { type: 'text', value: ' now' },
    ])
  })

  it('does not pull a bech32 entity out of a url path', () => {
    expect(parseContent(`https://njump.me/${npub}`)).toEqual([{ type: 'url', url: `https://njump.me/${npub}` }])
  })

  it('emits segments in source order across every token type', () => {
    const segments = parseContent(`#nostr nostr:${npub} https://example.com/x#y done`)
    expect(segments.map(segment => segment.type)).toEqual(['hashtag', 'text', 'mention', 'text', 'url', 'text'])
  })

  it('reassembles into the original string', () => {
    const source = `hi #nostr see https://example.com/a.png and nostr:${note}!`
    const rebuilt = parseContent(source)
      .map(segment => {
        switch (segment.type) {
          case 'text':
            return segment.value
          case 'hashtag':
            return `#${segment.tag}`
          case 'mention':
          case 'event':
          case 'address':
            return `nostr:${segment.bech32}`
          default:
            return 'url' in segment ? segment.url : ''
        }
      })
      .join('')
    expect(rebuilt).toBe(source)
  })
})

describe('parseContent urls', () => {
  it('classifies images by path extension, ignoring the query string', () => {
    expect(parseContent('https://cdn.example.com/a/b.JPG?w=800')).toEqual([
      { type: 'image', url: 'https://cdn.example.com/a/b.JPG?w=800' },
    ])
  })

  it('classifies video extensions', () => {
    expect(parseContent('https://v.example.com/clip.mp4')).toEqual([
      { type: 'video', url: 'https://v.example.com/clip.mp4' },
    ])
  })

  it('drops sentence punctuation but keeps balanced brackets', () => {
    expect(parseContent('See https://example.com/a.')).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'url', url: 'https://example.com/a' },
      { type: 'text', value: '.' },
    ])
    expect(parseContent('(https://example.com/a)')).toEqual([
      { type: 'text', value: '(' },
      { type: 'url', url: 'https://example.com/a' },
      { type: 'text', value: ')' },
    ])
    expect(parseContent('https://en.wikipedia.org/wiki/Nostr_(protocol)')).toEqual([
      { type: 'url', url: 'https://en.wikipedia.org/wiki/Nostr_(protocol)' },
    ])
  })
})

describe('parseContent nostr entities', () => {
  it('decodes a nostr: mention and keeps the bech32 for display', () => {
    expect(parseContent(`hey nostr:${npub}!`)).toEqual([
      { type: 'text', value: 'hey ' },
      { type: 'mention', pubkey: ALICE, bech32: npub },
      { type: 'text', value: '!' },
    ])
  })

  it('accepts a bare entity but not one glued to a word', () => {
    expect(parseContent(npub)).toEqual([{ type: 'mention', pubkey: ALICE, bech32: npub }])
    expect(parseContent(`x${npub}`)).toEqual([{ type: 'text', value: `x${npub}` }])
  })

  it('normalises nevent relay hints and exposes them', () => {
    const nevent = neventEncode({ id: NOTE, relays: ['wss://Relay.Example/'] })
    expect(parseContent(`nostr:${nevent}`)).toEqual([
      { type: 'event', id: NOTE, bech32: nevent, relays: ['wss://relay.example'] },
    ])
  })

  it('decodes naddr into its addressable parts', () => {
    const naddr = naddrEncode({ kind: 30023, pubkey: ALICE, identifier: 'my-post' })
    expect(parseContent(`nostr:${naddr}`)).toEqual([
      { type: 'address', kind: 30023, pubkey: ALICE, identifier: 'my-post', bech32: naddr },
    ])
  })

  it('falls back to text when the checksum is broken', () => {
    const broken = npub.slice(0, -1) + (npub.endsWith('q') ? 'p' : 'q')
    expect(parseContent(broken)).toEqual([{ type: 'text', value: broken }])
  })
})

describe('parseContent legacy #[n] references', () => {
  const tags = [
    ['p', ALICE.toUpperCase()],
    ['e', NOTE],
    ['a', `30023:${ALICE}:my-post`],
  ]

  it('resolves against the event tags and lowercases the hex', () => {
    expect(parseContent('hi #[0] see #[1]', tags)).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention', pubkey: ALICE, bech32: npub },
      { type: 'text', value: ' see ' },
      { type: 'event', id: NOTE, bech32: note },
    ])
  })

  it('resolves an a-tag reference to an address segment', () => {
    const segments = parseContent('#[2]', tags)
    expect(segments).toEqual([
      { type: 'address', kind: 30023, pubkey: ALICE, identifier: 'my-post', bech32: naddrEncode({ kind: 30023, pubkey: ALICE, identifier: 'my-post' }) },
    ])
  })

  it('leaves an out-of-range reference as written', () => {
    expect(parseContent('#[9]', tags)).toEqual([{ type: 'text', value: '#[9]' }])
    expect(parseContent('#[0]')).toEqual([{ type: 'text', value: '#[0]' }])
  })
})

describe('parseContent hashtags', () => {
  it('requires a word boundary and preserves casing', () => {
    expect(parseContent('a#b #nostr #Bitcoin! x')).toEqual([
      { type: 'text', value: 'a#b ' },
      { type: 'hashtag', tag: 'nostr' },
      { type: 'text', value: ' ' },
      { type: 'hashtag', tag: 'Bitcoin' },
      { type: 'text', value: '! x' },
    ])
  })

  it('handles non-ascii tags', () => {
    expect(parseContent('#günaydın')).toEqual([{ type: 'hashtag', tag: 'günaydın' }])
  })

  it('lowercases for t-tags while segments keep the original casing', () => {
    expect(hashtagsFromContent('#Nostr and #nostr and #Bitcoin')).toEqual(['nostr', 'bitcoin'])
  })
})

describe('parseContent payments', () => {
  const invoice = `lnbc10n1${'pqpzry9x8gf2tvdw0s3jn54khce6mua7l'.repeat(2)}`

  it('extracts a bolt11 invoice', () => {
    expect(parseContent(`pay ${invoice} please`)).toEqual([
      { type: 'text', value: 'pay ' },
      { type: 'invoice', bolt11: invoice },
      { type: 'text', value: ' please' },
    ])
  })

  it('strips a lightning: scheme and canonicalises an uppercase invoice', () => {
    expect(parseContent(`lightning:${invoice}`)).toEqual([{ type: 'invoice', bolt11: invoice }])
    expect(parseContent(invoice.toUpperCase())).toEqual([{ type: 'invoice', bolt11: invoice }])
  })

  it('extracts a cashu token without its scheme prefix', () => {
    const token = 'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBz'
    expect(parseContent(`redeem ${token}`)).toEqual([
      { type: 'text', value: 'redeem ' },
      { type: 'cashu', token },
    ])
    expect(parseContent(`web+cashu://${token}`)).toEqual([{ type: 'cashu', token }])
  })
})

describe('referencesFromContent', () => {
  it('collects everything the composer needs for tags, deduplicated', () => {
    expect(referencesFromContent(`nostr:${npub} nostr:${npub} nostr:${note} #Nostr`)).toEqual({
      pubkeys: [ALICE],
      eventIds: [NOTE],
      addresses: [],
      hashtags: ['nostr'],
    })
  })
})

// Kind-0 lives next to content parsing because both chew on the same untrusted.
function metadata(content: string, overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'c3'.repeat(32),
    pubkey: ALICE,
    created_at: 1_700_000_000,
    kind: 0,
    tags: [],
    content,
    sig: '0'.repeat(128),
    ...overrides,
  }
}

describe('parseProfile, malformed kind-0 content', () => {
  it('never throws, whatever the content is', () => {
    const garbage = [
      '',
      'not json',
      '<html>404</html>',
      '[]',
      'null',
      '42',
      '{"name":',
      '{"name": {"first": "a"}}',
      '{"name": ["a"]}',
      '{"name": null}',
      ' ',
    ]
    for (const content of garbage) {
      expect(() => parseProfile(metadata(content))).not.toThrow()
      expect(parseProfile(metadata(content))).toEqual({ pubkey: ALICE, updatedAt: 1_700_000_000 })
    }
  })

  it('coerces numbers to strings and drops empty and non-scalar fields', () => {
    const profile = parseProfile(
      metadata(JSON.stringify({ name: 12345, about: '  hi  ', displayName: '', picture: { url: 'x' }, banner: true })),
    )
    expect(profile.name).toBe('12345')
    expect(profile.about).toBe('hi')
    expect(profile.displayName).toBeUndefined()
    expect(profile.picture).toBeUndefined()
    expect(profile.banner).toBeUndefined()
  })

  it('unwraps double-encoded metadata', () => {
    expect(parseProfile(metadata(JSON.stringify(JSON.stringify({ name: 'alice' })))).name).toBe('alice')
  })

  it('reads both display_name spellings', () => {
    expect(parseProfile(metadata('{"displayName":"Legacy"}')).displayName).toBe('Legacy')
    expect(parseProfile(metadata('{"display_name":"Spec","displayName":"Legacy"}')).displayName).toBe('Spec')
  })

  it('refuses picture and banner URLs that are not http(s)', () => {
    const profile = parseProfile(
      metadata(JSON.stringify({ picture: 'javascript:alert(1)', banner: 'data:image/svg+xml;base64,AAAA' })),
    )
    expect(profile.picture).toBeUndefined()
    expect(profile.banner).toBeUndefined()
  })

  it('normalises nip05, website and lightning identifiers', () => {
    const profile = parseProfile(
      metadata(JSON.stringify({ nip05: 'Example.COM', website: 'example.com/me', lud16: 'LNURL1DP68' })),
    )
    expect(profile.nip05).toBe('_@example.com')
    expect(profile.website).toBe('https://example.com/me')
    expect(profile.lud06).toBe('lnurl1dp68')
    expect(profile.lud16).toBeUndefined()
  })

  it('rejects a nip05 that is not an identifier', () => {
    expect(parseProfile(metadata('{"nip05":"not an identifier"}')).nip05).toBeUndefined()
  })
})

describe('profile merging', () => {
  const older: Profile = { pubkey: ALICE, updatedAt: 100, name: 'alice', about: 'bio' }
  const newer: Profile = { pubkey: ALICE, updatedAt: 200, name: 'alice' }

  it('replaces wholesale so a deleted field stays deleted', () => {
    expect(mergeProfiles(older, newer)).toEqual(newer)
    expect(mergeProfiles(older, newer).about).toBeUndefined()
  })

  it('ignores a stale copy from a slower relay', () => {
    expect(mergeProfiles(newer, older)).toEqual(newer)
  })

  it('refuses to merge across pubkeys', () => {
    expect(mergeProfiles(newer, { pubkey: NOTE, updatedAt: 999, name: 'mallory' })).toEqual(newer)
  })

  it('breaks a created_at tie on the lowest id, as relays do', () => {
    const low = metadata('{"name":"low"}', { id: '11'.repeat(32) })
    const high = metadata('{"name":"high"}', { id: '99'.repeat(32) })
    expect(pickLatestMetadata([high, low])?.id).toBe(low.id)
    expect(pickLatestMetadata([low, { ...high, created_at: high.created_at + 1 }])?.id).toBe(high.id)
    expect(pickLatestMetadata([{ ...low, kind: 1 }])).toBeUndefined()
  })
})

describe('profileToTemplate', () => {
  it('round-trips and preserves fields this app does not model', () => {
    const profile = parseProfile(metadata(JSON.stringify({ name: 'alice', about: 'bio', bot: true })))
    const template = profileToTemplate(profile, { preserve: { bot: true }, createdAt: 5 })
    expect(template.kind).toBe(0)
    expect(template.created_at).toBe(5)
    expect(JSON.parse(template.content)).toEqual({ name: 'alice', about: 'bio', bot: true })
    expect(parseProfile(metadata(template.content)).name).toBe('alice')
  })

  it('falls back to a shortened npub for an empty profile', () => {
    expect(profileDisplayName({ pubkey: ALICE })).toBe(`${npub.slice(0, 10)}…${npub.slice(-6)}`)
    expect(profileDisplayName({ pubkey: ALICE, name: 'alice' })).toBe('alice')
  })
})

/** Bare domains, and the false positives that decide the shape of the rule. */
describe('parseContent, bare domains', () => {
  const kinds = (content: string): string =>
    parseContent(content, []).map(segment => segment.type).join(' ')
  const urlOf = (content: string): string | undefined => {
    const found = parseContent(content, []).find(segment => segment.type === 'url')
    return found?.type === 'url' ? found.url : undefined
  }

  it('links a bare domain', () => {
    expect(kinds('new client for the bull market. nostrich.org')).toBe('text url')
    expect(urlOf('new client for the bull market. nostrich.org')).toBe('https://nostrich.org')
  })

  it('keeps the path and links it too', () => {
    expect(urlOf('check nostrich.org/explore out')).toBe('https://nostrich.org/explore')
  })

  it('leaves trailing sentence punctuation out of the link', () => {
    expect(urlOf('go to nostrich.org.')).toBe('https://nostrich.org')
    expect(urlOf('(see nostrich.org)')).toBe('https://nostrich.org')
  })

  it('does not double up on a URL that already has a scheme', () => {
    expect(kinds('visit https://nostrich.org now')).toBe('text url text')
    expect(urlOf('visit https://nostrich.org now')).toBe('https://nostrich.org')
  })

  /** The reason the TLD list is an allowlist and not the IANA root. */
  it('does not link filenames that happen to end in a real TLD', () => {
    for (const content of [
      'see README.md for setup',
      'run main.py first',
      'edit build.sh',
      'it is in lib.rs',
      'the archive.zip is attached',
      'clip.mov plays fine',
      'check server.go',
    ]) {
      expect(kinds(content)).toBe('text')
    }
  })

  it('does not link abbreviations or numbers', () => {
    for (const content of ['i think e.g. this works', 'it cost 1.5 million', 'version 2.0 shipped']) {
      expect(kinds(content)).toBe('text')
    }
  })

  it('does not link the domain inside an email address', () => {
    expect(kinds('email me at hi@nostrich.org')).toBe('text')
  })

  it('still detects media by extension on a bare domain', () => {
    expect(kinds('look nostrich.org/cat.png')).toBe('text image')
  })

  it('links a bare domain at the very start of a note', () => {
    expect(kinds('nostrich.org is live')).toBe('url text')
  })
})

/** The composer paints these over a textarea, so they are offsets into the text. */
describe('linkRanges', () => {
  const marked = (content: string): string => {
    const ranges = linkRanges(content)
    let out = ''
    let cursor = 0
    for (const range of ranges) {
      out += content.slice(cursor, range.start) + '[' + content.slice(range.start, range.end) + ']'
      cursor = range.end
    }
    return out + content.slice(cursor)
  }

  it('covers exactly the domain as typed, with no scheme invented', () => {
    expect(marked('new client for the bull market. nostrich.org')).toBe(
      'new client for the bull market. [nostrich.org]',
    )
  })

  it('covers a full URL including its scheme', () => {
    expect(marked('see https://nostrich.org/explore now')).toBe('see [https://nostrich.org/explore] now')
  })

  it('marks hashtags and several links in one note', () => {
    expect(marked('#bitcoin on nostrich.org and example.com')).toBe(
      '[#bitcoin] on [nostrich.org] and [example.com]',
    )
  })

  it('marks nothing in a note with nothing to link', () => {
    expect(linkRanges('see README.md and run main.py, e.g. today')).toEqual([])
  })

  it('reports the type so the caller can style a hashtag differently from a link', () => {
    expect(linkRanges('#btc nostrich.org').map(range => range.type)).toEqual(['hashtag', 'url'])
  })

  it('stays aligned across multibyte characters', () => {
    const content = '🚀 zap me at nostrich.org'
    const [range] = linkRanges(content)
    expect(content.slice(range?.start, range?.end)).toBe('nostrich.org')
  })

  it('agrees with parseContent about what is a link', () => {
    for (const content of [
      'nostrich.org',
      'hi@nostrich.org',
      'README.md',
      'https://a.example/b?c=1 and #tag',
      'plain words only',
    ]) {
      const linked = parseContent(content).filter(segment => segment.type !== 'text').length
      expect(linkRanges(content)).toHaveLength(linked)
    }
  })
})

/** A `$` in a note is money far more often than anything else. */
describe('parseContent, a bare dollar sign', () => {
  const kinds = (content: string): string =>
    parseContent(content, []).map(segment => segment.type).join(' ')

  it('never turns a price into a link', () => {
    for (const content of [
      'it cost $100',
      'send me $5',
      'between $10 and $20',
      'US$50 shipping',
      '$1,000,000 target',
      'stacking $BTC today',
    ]) {
      expect(kinds(content), content).toBe('text')
    }
  })

  it('leaves hashtags and links alone around it', () => {
    expect(kinds('#bitcoin and $BTC on nostrich.org')).toBe('hashtag text url')
  })
})

/** Blank lines a COMPOSER left behind, not ones an author typed. */
describe('parseContent: whitespace at the edges', () => {
  const text = (segments: ReturnType<typeof parseContent>): string =>
    segments.filter(s => s.type === 'text').map(s => (s as { value: string }).value).join('')

  it('drops the blank lines a photo attachment leaves before the images', () => {
    const segments = parseContent('here are some butterflies 🦋\n\n\n\nhttps://i.example/a.jpg')
    expect(text(segments)).toBe('here are some butterflies 🦋')
    expect(segments.some(s => s.type === 'image')).toBe(true)
  })

  it('trims the top of a note as well as the bottom', () => {
    expect(text(parseContent('\n\n  gm  \n\n'))).toBe('gm')
  })

  /** The rule that keeps this from being an edit of somebody's writing. */
  it('leaves blank lines INSIDE a note exactly as written', () => {
    const body = 'first line\n\n\nsecond line, after a deliberate gap\n\nthird'
    expect(text(parseContent(body))).toBe(body)
  })

  it('keeps a paragraph break that sits between two images', () => {
    const segments = parseContent('one\n\nhttps://i.example/a.jpg\n\ntwo\n\nhttps://i.example/b.jpg')
    // The middle gap survives.
    expect(text(segments)).toBe('one\n\n\n\ntwo')
  })

  it('leaves a note with no text at all as just its media', () => {
    const segments = parseContent('\n\nhttps://i.example/a.jpg\n\n')
    expect(segments).toHaveLength(1)
    expect(segments[0]?.type).toBe('image')
  })
})

/** The separators a composer leaves between image URLs. */
describe('splitMedia', () => {
  it('drops the newlines that were separating hoisted images', () => {
    const { media, rest } = splitMedia(
      parseContent('butterflies 🦋\nhttps://i.example/a.jpg\nhttps://i.example/b.jpg'),
    )
    expect(media).toHaveLength(2)
    expect(rest.map(s => (s as { value: string }).value)).toEqual(['butterflies 🦋'])
  })

  it('keeps the space between two mentions, which is not an artefact', () => {
    const npub = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6'
    const { rest } = splitMedia(parseContent(`nostr:${npub} nostr:${npub}`))
    expect(rest.some(s => s.type === 'text' && s.value === ' ')).toBe(true)
  })

  it('keeps a paragraph break between two blocks of writing', () => {
    const { rest } = splitMedia(parseContent('first\n\nsecond'))
    expect(rest.map(s => (s as { value: string }).value)).toEqual(['first\n\nsecond'])
  })
})

/** Sound, which until this existed rendered as a bare link. */
describe('audio attachments', () => {
  it('reads the extensions the hosts actually serve', () => {
    for (const ext of ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'weba']) {
      expect(parseContent(`https://audio.nostr.build/x.${ext}`)).toEqual([
        { type: 'audio', url: `https://audio.nostr.build/x.${ext}` },
      ])
    }
  })

  it('keeps ogv a video while ogg is a track', () => {
    expect(parseContent('https://e.com/a.ogv')[0]).toMatchObject({ type: 'video' })
    expect(parseContent('https://e.com/a.ogg')[0]).toMatchObject({ type: 'audio' })
  })

  it('is media, so the whitespace that only separated it goes with it', () => {
    const { media, rest } = splitMedia(parseContent('listen\nhttps://e.com/song.mp3'))
    expect(media).toEqual([{ type: 'audio', url: 'https://e.com/song.mp3' }])
    // Not "listen\n": the newline existed to hold the URL apart from the words, and left.
    expect(rest).toEqual([{ type: 'text', value: 'listen' }])
  })

  it('leaves a query string alone when deciding', () => {
    expect(parseContent('https://e.com/song.m4a?t=90')[0]).toMatchObject({ type: 'audio' })
  })
})

describe('a mention carries the relay a pointer named', () => {
  const pubkey = '96c2cdf6ce94e07eb037918b6f38759f0625c26021dd59abba9d0e3eaec00129'

  it('keeps the hints inside an nprofile', () => {
    // The shape that matters: the mentioned key has no kind-0 on the usual relays.
    const nprofile =
      'nostr:nprofile1qy2hwumn8ghj7un9d3shjtty9ejhsctdwpkx2qpqjmpvmakwjns8avphjx9k7wr4nurztsnqy8w4n2a6n58ratkqqy5sdsk5cc'
    const mention = parseContent(`hello ${nprofile}`, []).find(s => s.type === 'mention')
    expect(mention?.pubkey).toBe(pubkey)
    expect(mention?.relays).toEqual(['wss://relay-d.example'])
  })

  it('keeps the relay on a `p` tag, which is the same hint in tag form', () => {
    const mention = parseContent('hello #[0]', [['p', pubkey, 'wss://relay-d.example']]).find(
      s => s.type === 'mention',
    )
    expect(mention?.relays).toEqual(['wss://relay-d.example'])
  })

  it('says nothing when a bare npub is all there was', () => {
    const npub = 'nostr:npub1jmpvmakwjns8avphjx9k7wr4nurztsnqy8w4n2a6n58ratkqqy5sru4hcl'
    const mention = parseContent(npub, []).find(s => s.type === 'mention')
    expect(mention?.pubkey).toBe(pubkey)
    expect(mention?.relays).toBeUndefined()
  })
})

/** NIP-30 custom emoji, and the reason the tag is not optional. */
describe('custom emoji', () => {
  const TAG = ['emoji', 'wisp_eyes', 'https://i.nostr.build/vtXPSL2ROiwGpAY8.png']

  it('renders a declared shortcode as an image', () => {
    const segments = parseContent(':wisp_eyes:', [TAG])
    expect(segments).toEqual([
      { type: 'emoji', shortcode: 'wisp_eyes', url: 'https://i.nostr.build/vtXPSL2ROiwGpAY8.png' },
    ])
  })

  it('keeps the words around it', () => {
    const segments = parseContent('gm :wisp_eyes: friends', [TAG])
    expect(segments.map(s => s.type)).toEqual(['text', 'emoji', 'text'])
    expect(segments[0]).toEqual({ type: 'text', value: 'gm ' })
    expect(segments[2]).toEqual({ type: 'text', value: ' friends' })
  })

  it('leaves an UNDECLARED shortcode as text', () => {
    expect(parseContent(':wisp_eyes:', [])).toEqual([{ type: 'text', value: ':wisp_eyes:' }])
  })

  it('does not turn a timestamp into a picture', () => {
    // The failure this rule exists for: `10:30:15` contains `:30:`.
    const segments = parseContent('meet at 10:30:15 sharp', [['emoji', '30', 'https://x.example/a.png']])
    expect(segments.every(s => s.type === 'text')).toBe(false)
    // The declared one IS an emoji.
    expect(segments.map(s => s.type)).toEqual(['text', 'emoji', 'text'])
    expect(segments[0]).toEqual({ type: 'text', value: 'meet at 10' })
    expect(segments[2]).toEqual({ type: 'text', value: '15 sharp' })
  })

  it('is case sensitive, as the NIP says', () => {
    expect(parseContent(':Wisp_Eyes:', [TAG])).toEqual([{ type: 'text', value: ':Wisp_Eyes:' }])
  })

  it('refuses a tag whose URL is not http', () => {
    // A tag is a stranger's string on its way to an `<img src>`.
    for (const bad of ['data:image/png;base64,AAA', 'javascript:alert(1)', 'file:///etc/passwd', '']) {
      expect(parseContent(':x:', [['emoji', 'x', bad]])).toEqual([{ type: 'text', value: ':x:' }])
    }
  })

  it('handles several emoji and several tags', () => {
    const tags = [TAG, ['emoji', 'pepe', 'https://x.example/pepe.png']]
    const segments = parseContent(':wisp_eyes: and :pepe:', tags)
    expect(segments.map(s => s.type)).toEqual(['emoji', 'text', 'emoji'])
  })

  it('does not pick a shortcode out of a URL', () => {
    const segments = parseContent('https://example.com/a:b:c', [['emoji', 'b', 'https://x.example/b.png']])
    expect(segments).toEqual([{ type: 'url', url: 'https://example.com/a:b:c' }])
  })
})

describe('truncateSegments', () => {
  /** A LONG NOTE IS FOLDED, AND THE CUT NEVER LANDS INSIDE A LINK. */
  const long = (n: number): string => 'word '.repeat(Math.ceil(n / 5)).slice(0, n)

  it('leaves an ordinary note alone', () => {
    expect(truncateSegments(parseContent('Good morning nostr', [])).truncated).toBe(false)
  })

  it('leaves a note only slightly over the limit alone', () => {
    // Cutting 300 characters at 280 hides twenty and costs a tap to get them back.
    expect(truncateSegments(parseContent(long(BODY_LIMIT + 20), [])).truncated).toBe(false)
  })

  it('folds a genuinely long note', () => {
    const result = truncateSegments(parseContent(long(BODY_LIMIT * 3), []))
    expect(result.truncated).toBe(true)
    const shown = result.shown.reduce(
      (sum, seg) => sum + (seg.type === 'text' ? seg.value.length : 0),
      0,
    )
    expect(shown).toBeLessThanOrEqual(BODY_LIMIT)
  })

  it('never splits a url', () => {
    const url = 'https://example.com/a-fairly-long-path-that-would-be-sliced'
    const shown = truncateSegments(
      parseContent(`${long(BODY_LIMIT)} ${url} ${long(BODY_LIMIT)}`, []),
    ).shown
    for (const seg of shown) if (seg.type === 'url') expect(seg.url).toBe(url)
  })

  it('does not leave a trailing space where it cut', () => {
    const shown = truncateSegments(parseContent(long(BODY_LIMIT * 2), [])).shown
    const last = shown.filter(seg => seg.type === 'text').at(-1)
    expect(last?.type === 'text' ? last.value.endsWith(' ') : true).toBe(false)
  })
})

