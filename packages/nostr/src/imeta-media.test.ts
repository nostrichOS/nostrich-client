import { describe, expect, it } from 'vitest'

import { parseContent, splitMedia } from './content'

/** THE FAILURE: a photo rendered as its own URL, in the middle of the note. */

const BLOSSOM = 'https://cdn-a.example/8a2a6862aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff66'

const imeta = (url: string, mime: string): string[] => ['imeta', `url ${url}`, `m ${mime}`, 'dim 1200x800']

describe('extensionless media, declared by imeta', () => {
  it('renders a declared image as an image, not as a link', () => {
    const segments = parseContent(`Burger's gettin' cheaper. ${BLOSSOM}`, [imeta(BLOSSOM, 'image/jpeg')])
    expect(segments.map(s => s.type)).toEqual(['text', 'image'])
    expect(splitMedia(segments).media).toHaveLength(1)
  })

  it('reads video and audio declarations too', () => {
    expect(parseContent(BLOSSOM, [imeta(BLOSSOM, 'video/mp4')])[0]?.type).toBe('video')
    expect(parseContent(BLOSSOM, [imeta(BLOSSOM, 'audio/mpeg')])[0]?.type).toBe('audio')
  })

  it('leaves an undeclared extensionless URL as a link', () => {
    // No imeta, no guess.
    expect(parseContent(BLOSSOM, [])[0]?.type).toBe('url')
  })

  it('matches the imeta entry by URL, not by position', () => {
    // A note with four pictures carries four unordered imeta tags.
    const other = 'https://cdn-a.example/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    const segments = parseContent(BLOSSOM, [imeta(other, 'image/jpeg')])
    expect(segments[0]?.type).toBe('url')
  })

  it('ignores a declaration for a type this app does not render', () => {
    expect(parseContent(BLOSSOM, [imeta(BLOSSOM, 'application/pdf')])[0]?.type).toBe('url')
  })

  it('lets the file extension win when there is one', () => {
    // The path is evidence the author's client wrote deliberately.
    const withExt = 'https://cdn-a.example/abc.jpg'
    expect(parseContent(withExt, [imeta(withExt, 'video/mp4')])[0]?.type).toBe('image')
  })

  it('survives a malformed imeta tag rather than throwing', () => {
    for (const tag of [['imeta'], ['imeta', 'url'], ['imeta', `url ${BLOSSOM}`], ['imeta', 'm image/jpeg']]) {
      expect(() => parseContent(BLOSSOM, [tag])).not.toThrow()
    }
    // An imeta naming the URL but declaring no type is not enough to call it a picture.
    expect(parseContent(BLOSSOM, [['imeta', `url ${BLOSSOM}`]])[0]?.type).toBe('url')
  })
})
