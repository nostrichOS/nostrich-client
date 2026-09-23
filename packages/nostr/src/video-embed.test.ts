import { describe, expect, it } from 'vitest'

import { videoEmbed } from './video-embed'

/** A wrong embed URL is worse than none: it replaces a working link with a grey box. */
describe('videoEmbed, YouTube', () => {
  const ID = 'dQw4w9WgXcQ'

  it('recognises every shape YouTube hands out', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?t=42`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/v/${ID}`,
    ]) {
      expect(videoEmbed(url)?.embedUrl, url).toBe(
        `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0`,
      )
    }
  })

  /** The regular domain sets tracking cookies as soon as the frame exists. */
  it('always uses the nocookie host', () => {
    expect(videoEmbed(`https://youtu.be/${ID}`)?.embedUrl).toContain('youtube-nocookie.com')
  })

  it('offers a still that costs no player load', () => {
    expect(videoEmbed(`https://youtu.be/${ID}`)?.poster).toBe(
      `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    )
  })

  it('refuses anything that is not an 11-character id', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=tooshort',
      'https://www.youtube.com/watch?v=' + 'a'.repeat(12),
      'https://www.youtube.com/watch?v=has.a.dot!',
      'https://www.youtube.com/',
      'https://www.youtube.com/@somechannel',
      'https://www.youtube.com/results?search_query=bitcoin',
    ]) {
      expect(videoEmbed(url), url).toBeUndefined()
    }
  })

  /** A lookalike domain must not get a player built. */
  it('does not match a host that merely contains the name', () => {
    for (const url of [
      'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      'https://myyoutu.be/dQw4w9WgXcQ',
    ]) {
      expect(videoEmbed(url), url).toBeUndefined()
    }
  })
})

describe('videoEmbed, other providers', () => {
  it('handles Vimeo', () => {
    expect(videoEmbed('https://vimeo.com/347119375')?.embedUrl).toBe(
      'https://player.vimeo.com/video/347119375?autoplay=1',
    )
  })

  it('handles Odysee', () => {
    const embed = videoEmbed('https://odysee.com/@channel:1/some-video:a')
    expect(embed?.provider).toBe('odysee')
    expect(embed?.embedUrl).toBe('https://odysee.com/$/embed/@channel:1/some-video:a?autoplay=1')
  })

  /** Rumble's watch page carries no id in the URL. */
  it('handles a Rumble embed link but refuses to guess at a watch page', () => {
    expect(videoEmbed('https://rumble.com/embed/v2abc/')?.provider).toBe('rumble')
    expect(videoEmbed('https://rumble.com/v6xyz-some-title.html')).toBeUndefined()
  })

  it('handles a Twitch clip', () => {
    expect(videoEmbed('https://clips.twitch.tv/SomeClipSlug')?.embedUrl).toContain(
      'clip=SomeClipSlug',
    )
  })

  it('leaves ordinary links alone', () => {
    for (const url of [
      'https://nostrich.org',
      'https://github.com/nostr-protocol/nips',
      'https://example.com/video.mp4',
      'not a url',
      '',
      'ftp://example.com/x',
    ]) {
      expect(videoEmbed(url), url).toBeUndefined()
    }
  })
})
