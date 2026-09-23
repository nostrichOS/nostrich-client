import { describe, expect, it } from 'vitest'

import { nextAuthors } from './stable-authors'

/** Unfollowing from a hover card rebuilt the timeline: the optimistic follow-list. */

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

describe('nextAuthors', () => {
  it('adopts the first list it is given', () => {
    expect(nextAuthors(undefined, [A, B], false)).toEqual([A, B])
  })

  it('IGNORES an unfollow while the timeline is on screen', () => {
    expect(nextAuthors([A, B], [A], false)).toEqual([A, B])
  })

  it('ignores a follow too, for the same reason', () => {
    // Not asymmetric on purpose: either edit rebuilding the feed costs the reader.
    expect(nextAuthors([A, B], [A, B, C], false)).toEqual([A, B])
  })

  it('takes the new list when the reader moves account, tab or feed', () => {
    expect(nextAuthors([A, B], [C], true)).toEqual([C])
  })

  it('accepts the answer arriving, which is not an edit', () => {
    // The contact list resolves after first render.
    expect(nextAuthors([], [A, B], false)).toEqual([A, B])
  })

  it('lets a move to an account that follows nobody through', () => {
    expect(nextAuthors([A, B], [], true)).toEqual([])
  })
})
