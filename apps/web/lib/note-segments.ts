import type { ContentSegment } from '@nostrich/nostr'

/** The blank line a removed segment leaves behind. */
export function trimSegmentEdges(segments: readonly ContentSegment[]): ContentSegment[] {
  const out = [...segments]
  while (out.length > 0 && isBlankText(out[out.length - 1])) out.pop()
  while (out.length > 0 && isBlankText(out[0])) out.shift()

  const last = out[out.length - 1]
  if (last !== undefined && last.type === 'text') {
    out[out.length - 1] = { ...last, value: last.value.replace(/\s+$/, '') }
  }
  const first = out[0]
  if (first !== undefined && first.type === 'text') {
    out[0] = { ...first, value: first.value.replace(/^\s+/, '') }
  }
  // A segment trimmed to nothing is not a segment.
  return out.filter(segment => !(segment.type === 'text' && segment.value === ''))
}

function isBlankText(segment: ContentSegment | undefined): boolean {
  return segment !== undefined && segment.type === 'text' && segment.value.trim() === ''
}
