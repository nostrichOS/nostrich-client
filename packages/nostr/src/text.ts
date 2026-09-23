/** Cutting text without cutting a character in half. */

const ELLIPSIS = '…'

/** Grapheme segmentation, not code points and certainly not UTF-16 units. */
const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined

/** The text as the units a reader would call characters. */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) return [...text]
  const out: string[] = []
  for (const unit of segmenter.segment(text)) out.push(unit.segment)
  return out
}

/** Cuts to at most `limit` graphemes, ELLIPSIS INCLUDED IN THE BUDGET. */
export function truncateGraphemes(text: string, limit: number): string {
  if (limit <= 0) return ''
  const units = graphemes(text)
  if (units.length <= limit) return text
  return units.slice(0, limit - 1).join('') + ELLIPSIS
}
