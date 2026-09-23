/** Links that are really videos, and where their player lives. */

export type VideoProvider =
  | 'youtube'
  | 'vimeo'
  | 'odysee'
  | 'rumble'
  | 'twitch'
  | 'dailymotion'
  | 'bitchute'
  | 'archive'
  | 'kick'
  | 'spotify'
  | 'soundcloud'
  | 'wavlake'
  | 'apple'

export interface VideoEmbed {
  provider: VideoProvider
  /** Audio embeds are a BAR, not a frame. */
  kind?: 'audio'
  /** Pixel height for an audio embed whose player is not the usual 152. Apple documents. */
  height?: number
  /** Loaded into an iframe only after the reader presses play. */
  embedUrl: string
  /** Shown as the still, when the provider offers one that costs no tracking to fetch. */
  poster?: string
}

/** Hosts we will build a player for, and nothing else. */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
])

function youtubeId(url: URL): string | undefined {
  const path = url.pathname.replace(/^\/+/, '')

  // youtu.be/<id>.
  if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
    return valid(path.split('/')[0])
  }
  // /watch?v=<id>.
  const query = url.searchParams.get('v')
  if (query !== null) return valid(query)
  // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>.
  const [first, second] = path.split('/')
  if (first !== undefined && ['shorts', 'embed', 'live', 'v'].includes(first)) return valid(second)
  return undefined
}

/** YouTube ids are 11 characters of a fixed alphabet. */
function valid(id: string | undefined): string | undefined {
  return id !== undefined && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined
}

export function videoEmbed(raw: string): VideoEmbed | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  const host = url.hostname.toLowerCase()

  if (YOUTUBE_HOSTS.has(host)) {
    const id = youtubeId(url)
    if (id === undefined) return undefined
    /** `youtube-nocookie.com`, and it is not cosmetic. */
    return {
      provider: 'youtube',
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
      // i.ytimg.com serves the still without cookies and without the player.
      poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    }
  }

  if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
    const id = /(?:^|\/)(\d{6,12})(?:$|[/?#])/.exec(url.pathname)?.[1]
    if (id === undefined) return undefined
    return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1` }
  }

  // Odysee keeps the same path on its embed host, so `/@channel/video:hash` maps.
  if (host === 'odysee.com' || host === 'www.odysee.com') {
    if (url.pathname.length <= 1) return undefined
    return { provider: 'odysee', embedUrl: `https://odysee.com/$/embed${url.pathname}?autoplay=1` }
  }

  if (host === 'rumble.com' || host === 'www.rumble.com') {
    // Only the already-embeddable form.
    const match = /^\/embed\/([A-Za-z0-9]+)/.exec(url.pathname)
    if (match === null) return undefined
    return { provider: 'rumble', embedUrl: `https://rumble.com/embed/${match[1]}/?pub=4` }
  }

  /* Twitch, and it is three different players behind one hostname. */
  if (host === 'twitch.tv' || host === 'www.twitch.tv' || host === 'clips.twitch.tv') {
    const parent = 'parent=nostrich.org'
    const segments = url.pathname.split('/').filter(part => part !== '')

    // clips.twitch.tv/<slug>.
    if (host === 'clips.twitch.tv') {
      const slug = segments[0]
      if (slug === undefined) return undefined
      return { provider: 'twitch', embedUrl: `https://clips.twitch.tv/embed?clip=${slug}&${parent}&autoplay=true` }
    }
    // twitch.tv/<channel>/clip/<slug>.
    if (segments.length === 3 && segments[1] === 'clip') {
      return {
        provider: 'twitch',
        embedUrl: `https://clips.twitch.tv/embed?clip=${segments[2]}&${parent}&autoplay=true`,
      }
    }
    // twitch.tv/videos/<id>.
    if (segments.length === 2 && segments[0] === 'videos' && /^\d+$/.test(segments[1] ?? '')) {
      return { provider: 'twitch', embedUrl: `https://player.twitch.tv/?video=${segments[1]}&${parent}&autoplay=true` }
    }
    // twitch.tv/<channel>.
    if (segments.length === 1 && /^[A-Za-z0-9_]{3,25}$/.test(segments[0] ?? '')) {
      return { provider: 'twitch', embedUrl: `https://player.twitch.tv/?channel=${segments[0]}&${parent}&autoplay=true` }
    }
    return undefined
  }

  if (host === 'dailymotion.com' || host === 'www.dailymotion.com' || host === 'dai.ly') {
    // dailymotion.com/video/<id> and the dai.ly short form.
    const id =
      host === 'dai.ly'
        ? url.pathname.split('/').filter(Boolean)[0]
        : /^\/video\/([A-Za-z0-9]+)/.exec(url.pathname)?.[1]
    if (id === undefined) return undefined
    return { provider: 'dailymotion', embedUrl: `https://geo.dailymotion.com/player.html?video=${id}` }
  }

  if (host === 'bitchute.com' || host === 'www.bitchute.com') {
    const id = /^\/video\/([A-Za-z0-9_-]+)/.exec(url.pathname)?.[1]
    if (id === undefined) return undefined
    return { provider: 'bitchute', embedUrl: `https://www.bitchute.com/embed/${id}/` }
  }

  if (host === 'archive.org' || host === 'www.archive.org') {
    // Only `/details/<id>`.
    const id = /^\/details\/([^/]+)/.exec(url.pathname)?.[1]
    if (id === undefined) return undefined
    return { provider: 'archive', embedUrl: `https://archive.org/embed/${id}` }
  }

  if (host === 'kick.com' || host === 'www.kick.com') {
    // Live channels only.
    const channel = /^\/([A-Za-z0-9_-]{3,25})$/.exec(url.pathname)?.[1]
    if (channel === undefined) return undefined
    return { provider: 'kick', embedUrl: `https://player.kick.com/${channel}?autoplay=true` }
  }

  /* ── AUDIO ───────────────────────────────────────────────────────────────────────. */
  if (host === 'open.spotify.com') {
    /* The `/intl-xx/` segment Spotify inserts for localised links is stripped: it sits. */
    const path = url.pathname.replace(/^\/intl-[a-z]{2}\//iu, '/')
    const match = /^\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/.exec(path)
    if (match === null) return undefined
    return {
      provider: 'spotify',
      kind: 'audio',
      embedUrl: `https://open.spotify.com/embed/${match[1]}/${match[2]}`,
    }
  }

  if (host === 'soundcloud.com' || host === 'www.soundcloud.com' || host === 'm.soundcloud.com') {
    // The widget resolves the public URL itself, so no API key and no id lookup.
    const segments = url.pathname.split('/').filter(part => part !== '')
    if (segments.length < 2 || RESERVED_SOUNDCLOUD.has(segments[0] ?? '')) return undefined
    const canonical = `https://soundcloud.com/${segments.join('/')}`
    return {
      provider: 'soundcloud',
      kind: 'audio',
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(canonical)}&auto_play=true&hide_related=true&show_comments=false`,
    }
  }

  if (host === 'wavlake.com' || host === 'www.wavlake.com') {
    // Bitcoin-native music, and the one on this list whose audience overlaps ours.
    const match = /^\/(track|album|artist)\/([A-Za-z0-9-]+)/.exec(url.pathname)
    if (match === null) return undefined
    return {
      provider: 'wavlake',
      kind: 'audio',
      embedUrl: `https://embed.wavlake.com/${match[1]}/${match[2]}`,
    }
  }

  /* Apple Podcasts and Apple Music, which share one trick: the embed player lives. */
  if (host === 'podcasts.apple.com' || host === 'music.apple.com') {
    if (!/^\/[a-z]{2}\//iu.test(url.pathname)) return undefined
    const embedHost = host === 'podcasts.apple.com' ? 'embed.podcasts.apple.com' : 'embed.music.apple.com'
    return {
      provider: 'apple',
      kind: 'audio',
      // Apple's own documented height for the compact player.
      height: 175,
      embedUrl: `https://${embedHost}${url.pathname}${url.search}`,
    }
  }

  return undefined
}

/** SoundCloud paths that are app screens rather than somebody's track. */
const RESERVED_SOUNDCLOUD = new Set([
  'you',
  'discover',
  'stream',
  'upload',
  'search',
  'settings',
  'pages',
  'terms-of-use',
  'imprint',
])
