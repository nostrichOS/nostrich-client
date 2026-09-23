import { describe, expect, it } from 'vitest'
import {
  decodePointer,
  encodeNaddr,
  encodeNevent,
  encodeNote,
  encodeNprofile,
  encodeNpub,
  type Hex,
  type NostrEvent,
} from '@nostrich/nostr'

import {
  entityHref,
  hashtagHref,
  isInternalEntity,
  linkKind,
  normalizeHashtag,
  noteHref,
  profileHref,
} from './links'

/** Where a link goes, and whether the two ends of one agree. */

const hex = (seed: string): Hex => seed.repeat(32).slice(0, 64)

const ALICE = hex('a1')
const NOTE_ID = hex('1a')

/** The pointer an internal /p/ or /e/ href actually carries. */
function pointerIn(href: string): ReturnType<typeof decodePointer> {
  const value = href.split('/')[2]
  return decodePointer(decodeURIComponent(value ?? ''))
}

describe('profileHref', () => {
  it('takes a pubkey in either spelling', () => {
    const npub = encodeNpub(ALICE)
    expect(profileHref(ALICE)).toBe(`/p/${ALICE}`)
    expect(profileHref(npub)).toBe(`/p/${npub}`)
  })

  /** The value reaches here from note content, so it must not be able to leave. */
  it('cannot be walked out of /p/', () => {
    expect(profileHref('../../admin?x=1')).toBe('/p/..%2F..%2Fadmin%3Fx%3D1')
  })
})

describe('noteHref', () => {
  it('points at the note with its author attached', () => {
    const href = noteHref({ id: NOTE_ID, pubkey: ALICE })

    expect(href.startsWith('/e/')).toBe(true)
    // The author is the half that makes the link work for a client that has never seen.
    expect(pointerIn(href)).toMatchObject({ type: 'nevent', id: NOTE_ID, author: ALICE })
  })

  /** QuotedNote resolves a pointer that has an id and nothing else. */
  it('links to the id alone when there is no author', () => {
    const pointer = pointerIn(noteHref({ id: NOTE_ID } as Pick<NostrEvent, 'id' | 'pubkey'>))

    expect(pointer).toMatchObject({ type: 'nevent', id: NOTE_ID })
    expect(pointer.type === 'nevent' && pointer.author).toBeUndefined()
  })

  /** An unusable author costs the author, never the link. */
  it('drops an author that is not a key rather than failing', () => {
    const href = noteHref({ id: NOTE_ID, pubkey: 'npub-shaped-nonsense' })

    expect(href).toBe(`/e/${encodeNote(NOTE_ID)}`)
    expect(pointerIn(href)).toMatchObject({ type: 'note', id: NOTE_ID })
  })
})

describe('entityHref', () => {
  it('keeps profiles and notes in the client', () => {
    for (const bech32 of [
      encodeNpub(ALICE),
      encodeNprofile({ pubkey: ALICE }),
      encodeNote(NOTE_ID),
      encodeNevent({ id: NOTE_ID, author: ALICE }),
    ]) {
      expect(isInternalEntity(bech32), bech32).toBe(true)
      expect(entityHref(bech32), bech32).toMatch(/^\/(p|e)\//)
    }
  })

  /** naddr has no route here yet, and an internal link would 404 instead of resolving. */
  it('hands an naddr to the resolver', () => {
    const naddr = encodeNaddr({ kind: 30023, pubkey: ALICE, identifier: 'a-long-form-post' })

    expect(isInternalEntity(naddr)).toBe(false)
    expect(entityHref(naddr)).toBe(`https://njump.me/${naddr}`)
  })

  /** Only the prefix is checked, so everything after it is still untrusted input. */
  it('cannot be walked out of /e/', () => {
    expect(entityHref('note1abc/../../settings')).toBe('/e/note1abc%2F..%2F..%2Fsettings')
  })
})

describe('normalizeHashtag', () => {
  /** `t` tags are published lowercase by convention and relays index them verbatim. */
  it('lowercases, trims, and drops the hashes the reader typed', () => {
    expect(normalizeHashtag('Nostr')).toBe('nostr')
    expect(normalizeHashtag('  ##Nostr  ')).toBe('nostr')
  })

  it('has nothing to search for', () => {
    for (const value of ['', '   ', '#', '###', null, undefined]) {
      expect(normalizeHashtag(value), JSON.stringify(value)).toBeNull()
    }
  })

  /** "open source" can never equal the "opensource" that was published. */
  it('rejects a tag with whitespace inside it', () => {
    expect(normalizeHashtag('open source')).toBeNull()
    expect(normalizeHashtag('#open\tsource')).toBeNull()
  })

  it('bounds the length without counting the hash against it', () => {
    const longest = 'n'.repeat(64)
    expect(normalizeHashtag(`#${longest}`)).toBe(longest)
    expect(normalizeHashtag('n'.repeat(65))).toBeNull()
  })

  /** Hashtags are not ASCII. */
  it('keeps non-ASCII tags', () => {
    expect(normalizeHashtag('#ΑΘΗΝΑ')).toBe('αθηνα')
    expect(normalizeHashtag('Ñoño')).toBe('ñoño')
    expect(normalizeHashtag('#比特币')).toBe('比特币')
  })
})

describe('the hashtag round trip', () => {
  /** One screen writes the link, another parses the query back out. */
  it('survives a link written by one screen and read by another', () => {
    const cases: Array<[string, string]> = [
      ['Nostr', 'nostr'],
      ['#Nostr', 'nostr'],
      ['Ñoño', 'ñoño'],
    ]

    for (const [written, expected] of cases) {
      const url = new URL(hashtagHref(written), 'https://nostrich.org')
      expect(url.pathname, written).toBe('/')
      expect(normalizeHashtag(url.searchParams.get('t')), written).toBe(expected)
    }
  })
})

/** Internal vs external, decided from the href. */
describe('linkKind', () => {
  it('keeps our own routes in the app', () => {
    for (const href of ['/p/npub1abc', '/e/note1abc', '/?t=bitcoin', '/explore?q=%24AAPL']) {
      expect(linkKind(href), href).toEqual({ kind: 'internal', href })
    }
  })

  it('classifies every href builder in this file as internal', () => {
    expect(linkKind(entityHref('npub1abc')).kind).toBe('internal')
    expect(linkKind(entityHref('note1abc')).kind).toBe('internal')
    expect(linkKind(profileHref('npub1abc')).kind).toBe('internal')
    expect(linkKind(hashtagHref('bitcoin')).kind).toBe('internal')
  })

  it('sends real outbound links out, in a new tab', () => {
    const kind = linkKind('https://example.com/x')
    expect(kind.kind).toBe('external')
    if (kind.kind !== 'external') throw new Error('unreachable')
    expect(kind.target).toBe('_blank')
    expect(kind.rel).toContain('noopener')
  })

  it('treats a protocol-relative URL as external, not as one of our routes', () => {
    // `//evil.example` is a different ORIGIN wearing a path's clothes.
    expect(linkKind('//evil.example').kind).toBe('external')
  })

  it('refuses script-bearing schemes rather than linking them', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:msgbox']) {
      expect(linkKind(href).kind, href).toBe('refused')
    }
  })

  it('refuses what is not a link at all', () => {
    expect(linkKind('').kind).toBe('refused')
    expect(linkKind('   ').kind).toBe('refused')
    expect(linkKind('just some words').kind).toBe('refused')
  })

  it('allows the non-http schemes a Nostr client actually uses', () => {
    expect(linkKind('lightning:lnbc1...').kind).toBe('external')
    expect(linkKind('mailto:someone@example.com').kind).toBe('external')
  })
})
