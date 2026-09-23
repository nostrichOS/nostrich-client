import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@nostrich/nostr'

import { mediaOnlyLabel } from './media-only'
import { quotedPieces } from './quoted-pieces'

/** The rail row for a note with no words. */

const IMAGE = 'https://cdn-a.example/one.jpg'
const IMAGE_2 = 'https://cdn-a.example/two.png'
const VIDEO = 'https://cdn-a.example/clip.mp4'
const VIDEO_2 = 'https://cdn-a.example/other.webm'
const AUDIO = 'https://cdn-a.example/track.mp3'

const note = (content: string, tags: string[][] = []): NostrEvent =>
  ({
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 1,
    created_at: 1,
    tags,
    content,
    sig: '',
  }) as NostrEvent

const labelFor = (content: string, tags: string[][] = []): string | null => {
  const event = note(content, tags)
  return mediaOnlyLabel(event, quotedPieces(event))
}

describe('mediaOnlyLabel', () => {
  it('names a lone picture', () => {
    expect(labelFor(IMAGE)).toBe('Image note')
  })

  it('calls two or more pictures a gallery', () => {
    expect(labelFor(`${IMAGE}\n${IMAGE_2}`)).toBe('Image gallery')
  })

  it('names a lone clip', () => {
    expect(labelFor(VIDEO)).toBe('Video note')
  })

  it('calls two or more clips a gallery', () => {
    expect(labelFor(`${VIDEO}\n${VIDEO_2}`)).toBe('Video gallery')
  })

  it('names audio without counting it', () => {
    expect(labelFor(AUDIO)).toBe('Audio')
    expect(labelFor(`${AUDIO}\n${AUDIO}`)).toBe('Audio')
  })

  it('calls a mixture a media gallery rather than picking one of them', () => {
    expect(labelFor(`${IMAGE}\n${VIDEO}`)).toBe('Media gallery')
  })

  it('recognises an extensionless Blossom upload by its imeta type', () => {
    const url = 'https://cdn-a.example/8a2a6862'
    expect(labelFor(url, [['imeta', `url ${url}`, 'm image/jpeg']])).toBe('Image note')
  })

  it('says nothing when the note has words', () => {
    expect(labelFor(`look at this\n${IMAGE}`)).toBeNull()
  })

  it('says nothing when the only text is a hashtag or a mention', () => {
    expect(labelFor(`#nostr\n${IMAGE}`)).toBeNull()
  })

  it('says nothing for a note that has no media either', () => {
    expect(labelFor('')).toBeNull()
    expect(labelFor('\n\n')).toBeNull()
  })

  it('ignores whitespace the composer left around the media', () => {
    expect(labelFor(`\n\n${IMAGE}\n\n`)).toBe('Image note')
  })
})
