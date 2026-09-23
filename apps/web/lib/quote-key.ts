import type { QuotePointer } from '../components/QuotedNote'

/** The cache key for a quote lookup. */
export function quotedNoteKey(pointer: QuotePointer | undefined): readonly unknown[] {
  return [
    'quoted-note',
    pointer?.id ?? '',
    pointer?.author ?? '',
    [...(pointer?.relays ?? [])].sort().join(','),
  ]
}
