/** Media whose host moved, repaired at render time. */

export interface MovedHost {
  from: string
  to: string
  /** Why, in a line, so a future reader can decide whether it still belongs here. */
  note: string
}

export const MOVED_MEDIA_HOSTS: readonly MovedHost[] = Object.freeze([
  {
    from: 'heyframe.com',
    to: 'frameterminal.com',
    // The domain was sold after the migration and is now parked by its new owner.
    note: 'heyframe.com → frameterminal.com, 2026; old domain sold and parked',
  },
])

/** The URL to actually fetch a piece of media. */
/** `http://` media, upgraded to `https://`. */
export function secureMediaUrl(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url
}

export function repairMediaUrl(url: string): string {
  const secure = secureMediaUrl(url)
  // Cheap reject before constructing a URL: this runs for every image in every note.
  if (!secure.startsWith('https://')) return secure
  const url_ = secure

  let parsed: URL
  try {
    parsed = new URL(url_)
  } catch {
    return url_
  }

  const host = parsed.hostname.toLowerCase()
  for (const moved of MOVED_MEDIA_HOSTS) {
    if (host !== moved.from && host !== `www.${moved.from}`) continue
    parsed.hostname = moved.to
    // The port belongs to the old host and is meaningless on the new one.
    parsed.port = ''
    return parsed.toString()
  }
  return url_
}
