import { describe, expect, it } from 'vitest'

import { videoEmbed } from './video-embed'

/** The providers added alongside YouTube and Vimeo. */

describe('twitch', () => {
  it('embeds a bare channel as the CHANNEL player', () => {
    /* THE REGRESSION THIS FILE EXISTS. */
    const embed = videoEmbed('https://twitch.tv/shroud')
    expect(embed?.embedUrl).toContain('player.twitch.tv/?channel=shroud')
    expect(embed?.embedUrl).not.toContain('clip=')
  })

  it('embeds a past broadcast', () => {
    expect(videoEmbed('https://www.twitch.tv/videos/123456789')?.embedUrl).toContain(
      'player.twitch.tv/?video=123456789',
    )
  })

  it('still embeds both clip forms', () => {
    expect(videoEmbed('https://clips.twitch.tv/SomeClipSlug')?.embedUrl).toContain('clip=SomeClipSlug')
    expect(videoEmbed('https://twitch.tv/shroud/clip/SomeClipSlug')?.embedUrl).toContain(
      'clip=SomeClipSlug',
    )
  })

  it('always names the parent, which Twitch refuses to frame without', () => {
    for (const url of ['https://twitch.tv/shroud', 'https://twitch.tv/videos/1', 'https://clips.twitch.tv/x']) {
      expect(videoEmbed(url)?.embedUrl).toContain('parent=nostrich.org')
    }
  })
})

describe('spotify', () => {
  it('embeds each content type', () => {
    for (const type of ['track', 'album', 'playlist', 'episode', 'show']) {
      const embed = videoEmbed(`https://open.spotify.com/${type}/4cOdK2wGLETKBW3PvgPWqT`)
      expect(embed?.embedUrl).toBe(`https://open.spotify.com/embed/${type}/4cOdK2wGLETKBW3PvgPWqT`)
      expect(embed?.kind).toBe('audio')
    }
  })

  it('strips the localised /intl-xx/ segment', () => {
    /* Spotify inserts it between the host and the type, so reading the first path segment. */
    expect(videoEmbed('https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT')?.embedUrl).toBe(
      'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT',
    )
  })

  it('ignores a Spotify URL that is not content', () => {
    expect(videoEmbed('https://open.spotify.com/')).toBeUndefined()
  })
})

describe('soundcloud', () => {
  it('hands the public URL to the widget, which resolves it without an API key', () => {
    const embed = videoEmbed('https://soundcloud.com/artist/some-track')
    expect(embed?.kind).toBe('audio')
    expect(embed?.embedUrl).toContain('w.soundcloud.com/player/')
    expect(embed?.embedUrl).toContain(encodeURIComponent('https://soundcloud.com/artist/some-track'))
  })

  it('refuses app screens that are not somebody’s track', () => {
    // `/discover` and friends are pages, not audio.
    expect(videoEmbed('https://soundcloud.com/discover/sets')).toBeUndefined()
    expect(videoEmbed('https://soundcloud.com/artist')).toBeUndefined()
  })
})

describe('the rest', () => {
  it('maps dailymotion, bitchute, archive.org, kick and wavlake', () => {
    expect(videoEmbed('https://www.dailymotion.com/video/x8abcd1')?.embedUrl).toContain(
      'geo.dailymotion.com/player.html?video=x8abcd1',
    )
    expect(videoEmbed('https://dai.ly/x8abcd1')?.embedUrl).toContain('video=x8abcd1')
    expect(videoEmbed('https://www.bitchute.com/video/abc123XYZ/')?.embedUrl).toBe(
      'https://www.bitchute.com/embed/abc123XYZ/',
    )
    expect(videoEmbed('https://archive.org/details/some-item')?.embedUrl).toBe(
      'https://archive.org/embed/some-item',
    )
    expect(videoEmbed('https://kick.com/somechannel')?.embedUrl).toContain(
      'player.kick.com/somechannel',
    )
    const wav = videoEmbed('https://wavlake.com/track/abc-123-def')
    expect(wav?.embedUrl).toBe('https://embed.wavlake.com/track/abc-123-def')
    expect(wav?.kind).toBe('audio')
  })

  it('does not frame a non-player page on those hosts', () => {
    // `/download` and `/search` are not players, and a grey box is worse than a plain link.
    expect(videoEmbed('https://archive.org/search?query=x')).toBeUndefined()
    expect(videoEmbed('https://www.dailymotion.com/somechannel')).toBeUndefined()
  })

  it('leaves an unrelated URL alone', () => {
    expect(videoEmbed('https://example.com/video/123')).toBeUndefined()
  })
})

describe('apple', () => {
  it('embeds a podcast episode, keeping the ?i= that names it', () => {
    /* `?i=<episodeId>` is the only thing separating an episode from the show it belongs. */
    const embed = videoEmbed(
      'https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000650000000',
    )
    expect(embed?.embedUrl).toBe(
      'https://embed.podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000650000000',
    )
    expect(embed?.kind).toBe('audio')
  })

  it('uses Apple’s own player height, not the Spotify one', () => {
    // At 152 the play control is clipped off the bottom of Apple's frame.
    expect(videoEmbed('https://podcasts.apple.com/us/podcast/x/id1')?.height).toBe(175)
  })

  it('embeds Apple Music on the same rule', () => {
    expect(videoEmbed('https://music.apple.com/us/album/abbey-road/1441164426')?.embedUrl).toBe(
      'https://embed.music.apple.com/us/album/abbey-road/1441164426',
    )
  })

  it('ignores an Apple URL with no storefront segment', () => {
    // Every real content URL carries a two-letter storefront.
    expect(videoEmbed('https://podcasts.apple.com/')).toBeUndefined()
    expect(videoEmbed('https://music.apple.com/browse')).toBeUndefined()
  })
})
