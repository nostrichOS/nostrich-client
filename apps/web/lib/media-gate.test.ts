import { describe, expect, it } from 'vitest'

import {
  IMAGE_MIN_FOLLOWERS,
  VIDEO_MIN_FOLLOWERS,
  gateFiles,
  mediaGate,
  mediaGateMessage,
  mediaKindOf,
} from './media-gate'
import type { Hex, Profile } from '@nostrich/nostr'

/** The rule that decides who may attach a file. */

const profile = (fields: Partial<Profile> = {}): Profile => ({
  pubkey: 'a'.repeat(64) as Hex,
  updatedAt: 1,
  ...fields,
})

const complete = profile({ picture: 'https://example.com/me.jpg', displayName: 'Alice' })

describe('mediaGate, the profile half', () => {
  it('refuses an account with nothing set, and names both gaps', () => {
    const verdict = mediaGate('image', { profile: null, followers: 500 })
    expect(verdict).toEqual({ ok: false, reason: 'profile', needsPicture: true, needsName: true })
  })

  it('accepts a name in either NIP-01 field', () => {
    for (const named of [{ displayName: 'Alice' }, { name: 'alice' }]) {
      const verdict = mediaGate('image', {
        profile: profile({ picture: 'https://example.com/me.jpg', ...named }),
        followers: 5,
      })
      expect(verdict).toEqual({ ok: true })
    }
  })

  it('does not accept whitespace as a name or a picture', () => {
    const verdict = mediaGate('image', {
      profile: profile({ picture: '   ', displayName: '  ' }),
      followers: 500,
    })
    expect(verdict).toEqual({ ok: false, reason: 'profile', needsPicture: true, needsName: true })
  })

  it('asks for the profile before the followers, because that is the part they can fix now', () => {
    const verdict = mediaGate('image', { profile: profile({ displayName: 'Alice' }), followers: 0 })
    expect(verdict).toEqual({ ok: false, reason: 'profile', needsPicture: true, needsName: false })
  })
})

describe('mediaGate, the follower half', () => {
  it('holds images at 5 and videos at 10', () => {
    expect(IMAGE_MIN_FOLLOWERS).toBe(5)
    expect(VIDEO_MIN_FOLLOWERS).toBe(10)

    expect(mediaGate('image', { profile: complete, followers: 4 })).toEqual({
      ok: false,
      reason: 'followers',
      need: 5,
      have: 4,
    })
    expect(mediaGate('image', { profile: complete, followers: 5 })).toEqual({ ok: true })

    expect(mediaGate('video', { profile: complete, followers: 9 })).toEqual({
      ok: false,
      reason: 'followers',
      need: 10,
      have: 9,
    })
    expect(mediaGate('video', { profile: complete, followers: 10 })).toEqual({ ok: true })
  })

  it('an account that clears images does NOT thereby clear video', () => {
    expect(mediaGate('image', { profile: complete, followers: 6 })).toEqual({ ok: true })
    expect(mediaGate('video', { profile: complete, followers: 6 })).toEqual({
      ok: false,
      reason: 'followers',
      need: 10,
      have: 6,
    })
  })

  it('BLOCKS while the count is unknown rather than opening on a slow relay', () => {
    expect(mediaGate('image', { profile: complete, followers: undefined })).toEqual({
      ok: false,
      reason: 'checking',
    })
  })
})

describe('mediaKindOf', () => {
  it('reads an image as an image', () => {
    expect(mediaKindOf({ type: 'image/jpeg' })).toBe('image')
    expect(mediaKindOf({ type: 'image/gif' })).toBe('image')
  })

  it('treats everything else as video, including the unrecognised', () => {
    // A phone voice note arrives as video/mp4.
    expect(mediaKindOf({ type: 'video/mp4' })).toBe('video')
    expect(mediaKindOf({ type: 'audio/mpeg' })).toBe('video')
    expect(mediaKindOf({ type: '' })).toBe('video')
    expect(mediaKindOf({ type: 'application/octet-stream' })).toBe('video')
  })
})

describe('gateFiles', () => {
  it('judges a mixed drop on the video bar, not the image one', () => {
    const files = [{ type: 'image/png' }, { type: 'video/mp4' }]
    expect(gateFiles(files, { profile: complete, followers: 7 })).toEqual({
      ok: false,
      reason: 'followers',
      need: 10,
      have: 7,
    })
  })

  it('lets a photo-only drop through at the image bar', () => {
    expect(gateFiles([{ type: 'image/png' }], { profile: complete, followers: 7 })).toEqual({
      ok: true,
    })
  })
})

describe('mediaGateMessage', () => {
  it('says what to do, and that text still works', () => {
    const verdict = mediaGate('image', { profile: null, followers: 100 })
    expect(mediaGateMessage(verdict, 'image')).toBe(
      'Add a profile picture and a display name to post photos. You can post text now.',
    )
  })

  it('names only the missing half', () => {
    const verdict = mediaGate('video', {
      profile: profile({ displayName: 'Alice' }),
      followers: 100,
    })
    expect(mediaGateMessage(verdict, 'video')).toBe(
      'Add a profile picture to post videos. You can post text now.',
    )
  })

  it('reports the count as what we can SEE, never as a total', () => {
    const verdict = mediaGate('video', { profile: complete, followers: 3 })
    expect(mediaGateMessage(verdict, 'video')).toBe(
      'You need 10 followers to post videos, we can see 3. You can post text now.',
    )
  })

  it('does not accuse anybody while it is still looking', () => {
    const verdict = mediaGate('image', { profile: complete, followers: undefined })
    expect(mediaGateMessage(verdict, 'image')).toBe('Checking your profile…')
  })

  it('says nothing when the answer is yes', () => {
    expect(mediaGateMessage({ ok: true }, 'image')).toBeUndefined()
  })
})
