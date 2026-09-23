import { describe, expect, it } from 'vitest'

import { removeUrl } from './attached-link'

/** Taking a link out of somebody's half-written note, without taking anything else. */

const URL = 'https://example.com/a-very-long-article-slug'

describe('removeUrl', () => {
  it('takes the line with a URL that had one to itself', () => {
    expect(removeUrl(`Worth reading:\n${URL}`, URL)).toBe('Worth reading:')
    expect(removeUrl(`${URL}\nWorth reading`, URL)).toBe('Worth reading')
  })

  it('collapses the hole left in the middle of a note', () => {
    // Two paragraphs either side must not become four blank lines.
    expect(removeUrl(`First\n\n${URL}\n\nSecond`, URL)).toBe('First\n\nSecond')
  })

  it('leaves a sentence joined when the link was inside it', () => {
    expect(removeUrl(`see ${URL} for more`, URL)).toBe('see for more')
  })

  it('takes the trailing space with a link at the end', () => {
    expect(removeUrl(`Read this ${URL}`, URL)).toBe('Read this')
    expect(removeUrl(URL, URL)).toBe('')
  })

  it('removes one occurrence, not both', () => {
    // Somebody quoting the same link twice meant.
    expect(removeUrl(`${URL} and ${URL}`, URL)).toBe(`and ${URL}`)
  })

  it('leaves the draft alone when the link is not in it', () => {
    expect(removeUrl('nothing to see', URL)).toBe('nothing to see')
  })
})
