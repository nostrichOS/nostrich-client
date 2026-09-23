import { describe, expect, it } from 'vitest'

import { collapseBlankRuns, mergeTextSegments } from './content'
import type { ContentSegment } from './types'

/** The hole a removed segment leaves behind. */

const text = (value: string): ContentSegment => ({ type: 'text', value })
const hashtag = (tag: string): ContentSegment => ({ type: 'hashtag', tag }) as ContentSegment

describe('mergeTextSegments', () => {
  it('joins the neighbours a removed segment leaves behind', () => {
    const merged = mergeTextSegments([text('…live/\n\n'), text('\n\n#livestream')])
    expect(merged).toHaveLength(1)
    expect((merged[0] as { value: string }).value).toBe('…live/\n\n\n\n#livestream')
  })

  it('is what makes the collapse able to see the run', () => {
    /* THE REGRESSION. */
    const apart = [text('…live/\n\n'), text('\n\n#livestream')]
      .map(s => collapseBlankRuns((s as { value: string }).value))
      .join('')
    expect(apart).toBe('…live/\n\n\n\n#livestream')

    const together = collapseBlankRuns(
      (mergeTextSegments(apart === '' ? [] : [text('…live/\n\n'), text('\n\n#livestream')])[0] as {
        value: string
      }).value,
    )
    expect(together).toBe('…live/\n\n#livestream')
  })

  it('leaves non-text segments and their order alone', () => {
    const segments = [text('a'), hashtag('x'), text('b'), text('c'), hashtag('y')]
    const merged = mergeTextSegments(segments)
    expect(merged.map(s => s.type)).toEqual(['text', 'hashtag', 'text', 'hashtag'])
    expect((merged[2] as { value: string }).value).toBe('bc')
  })

  it('does not merge across a segment that survived', () => {
    // Only ADJACENT text joins.
    const merged = mergeTextSegments([text('a\n'), hashtag('x'), text('\nb')])
    expect(merged).toHaveLength(3)
  })

  it('passes an already-clean list through unchanged', () => {
    const segments = [text('hello '), hashtag('x')]
    expect(mergeTextSegments(segments)).toEqual(segments)
  })

  it('handles an empty list', () => {
    expect(mergeTextSegments([])).toEqual([])
  })
})
