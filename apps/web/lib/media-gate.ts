import type { Profile } from '@nostrich/nostr'

/** WHO MAY ATTACH A PICTURE OR A VIDEO, and who gets text only. */

/** Both apply on top of a picture and a name. */
export const IMAGE_MIN_FOLLOWERS = 5
export const VIDEO_MIN_FOLLOWERS = 10

export type MediaKind = 'image' | 'video'

/** Why an attachment was refused. */
export type MediaVerdict =
  | { ok: true }
  | { ok: false; reason: 'checking' }
  | { ok: false; reason: 'profile'; needsPicture: boolean; needsName: boolean }
  | { ok: false; reason: 'followers'; need: number; have: number }

export interface MediaGateInput {
  /** The author's own kind-0, or null while it loads / when they have never published one. */
  profile: Profile | null
  /** Followers, as counted. */
  followers: number | undefined
}

/** A name they chose, in either field NIP-01 offers, and not just whitespace. */
const named = (profile: Profile | null): boolean =>
  (profile?.displayName ?? '').trim() !== '' || (profile?.name ?? '').trim() !== ''

/** A picture they set. */
const pictured = (profile: Profile | null): boolean => (profile?.picture ?? '').trim() !== ''

export function mediaGate(kind: MediaKind, input: MediaGateInput): MediaVerdict {
  const needsPicture = !pictured(input.profile)
  const needsName = !named(input.profile)
  /* The profile half first, because it is the half the author can fix in the next. */
  if (needsPicture || needsName) return { ok: false, reason: 'profile', needsPicture, needsName }

  const need = kind === 'video' ? VIDEO_MIN_FOLLOWERS : IMAGE_MIN_FOLLOWERS
  /* Unknown BLOCKS rather than allows. */
  if (input.followers === undefined) return { ok: false, reason: 'checking' }
  if (input.followers < need) return { ok: false, reason: 'followers', need, have: input.followers }

  return { ok: true }
}

/** What a file counts. */
export const mediaKindOf = (file: { type: string }): MediaKind =>
  file.type.startsWith('image/') ? 'image' : 'video'

/** The strictest verdict across a batch. */
export function gateFiles(files: readonly { type: string }[], input: MediaGateInput): MediaVerdict {
  /* Video first: a mixed drop of one photo and one clip is a video post as far. */
  const kinds: MediaKind[] = files.some(file => mediaKindOf(file) === 'video')
    ? ['video']
    : ['image']
  for (const kind of kinds) {
    const verdict = mediaGate(kind, input)
    if (!verdict.ok) return verdict
  }
  return { ok: true }
}

/** The sentence the composer shows. */
export function mediaGateMessage(verdict: MediaVerdict, kind: MediaKind): string | undefined {
  if (verdict.ok) return undefined
  const noun = kind === 'video' ? 'videos' : 'photos'
  if (verdict.reason === 'checking') return 'Checking your profile…'
  if (verdict.reason === 'profile') {
    const missing = [
      verdict.needsPicture ? 'a profile picture' : undefined,
      verdict.needsName ? 'a display name' : undefined,
    ].filter((part): part is string => part !== undefined)
    return `Add ${missing.join(' and ')} to post ${noun}. You can post text now.`
  }
  return `You need ${verdict.need} followers to post ${noun}, we can see ${verdict.have}. You can post text now.`
}
