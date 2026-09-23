import { describe, expect, it } from 'vitest'

import { collapseBlankRuns } from './content'

/** A screen of nothing in the middle of a note. */

describe('collapseBlankRuns', () => {
  it('leaves a single blank line alone', () => {
    expect(collapseBlankRuns('First paragraph.\n\nSecond paragraph.')).toBe(
      'First paragraph.\n\nSecond paragraph.',
    )
  })

  it('leaves an ordinary line break alone', () => {
    expect(collapseBlankRuns('One line\nand the next')).toBe('One line\nand the next')
  })

  it('collapses a run of empty rows to one', () => {
    expect(collapseBlankRuns('Above\n\n\n\n\n\nBelow')).toBe('Above\n\nBelow')
  })

  it('treats a line of spaces as empty, because it looks empty', () => {
    expect(collapseBlankRuns('Above\n   \n \t \nBelow')).toBe('Above\n\nBelow')
  })

  it('collapses every run in a note, not only the first', () => {
    expect(collapseBlankRuns('a\n\n\nb\n\n\n\nc')).toBe('a\n\nb\n\nc')
  })

  it('leaves a note with no blank lines byte-for-byte', () => {
    const note = 'Nothing to do here. https://example.com #nostr'
    expect(collapseBlankRuns(note)).toBe(note)
  })

  it('does not invent a break in text that has none', () => {
    expect(collapseBlankRuns('')).toBe('')
    expect(collapseBlankRuns('   ')).toBe('   ')
  })
})
