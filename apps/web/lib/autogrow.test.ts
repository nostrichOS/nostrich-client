import { describe, expect, it } from 'vitest'

import { atBottom } from './autogrow'

/** "Was the reader looking at the bottom of this box before it changed height?". */
describe('atBottom', () => {
  it('is true at the exact bottom', () => {
    expect(atBottom(400, 1000, 600)).toBe(true)
  })

  it('tolerates the sub-pixel the browser reports on a fractional layout', () => {
    // 399.5 rounds around between reads.
    expect(atBottom(399.5, 1000, 600)).toBe(true)
  })

  it('is false anywhere the reader has genuinely scrolled up to', () => {
    expect(atBottom(0, 1000, 600)).toBe(false)
    expect(atBottom(200, 1000, 600)).toBe(false)
    expect(atBottom(398, 1000, 600)).toBe(false)
  })

  it('is true for a box that cannot scroll at all', () => {
    // The compose modal's textarea: overflow-hidden and unbounded, so scrollTop is always.
    expect(atBottom(0, 600, 600)).toBe(true)
  })

  it('is true past the bottom, which is what a mid-measurement box reports', () => {
    // While height is `auto` the content is briefly shorter than the offset already held.
    expect(atBottom(400, 500, 600)).toBe(true)
  })
})
