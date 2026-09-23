import { describe, expect, it } from 'vitest'
import type { ContentSegment } from '@nostrich/nostr'

import { trimSegmentEdges } from './note-segments'

const text = (value: string): ContentSegment => ({ type: 'text', value }) as ContentSegment
const event = (): ContentSegment => ({ type: 'event', id: 'a'.repeat(64) }) as ContentSegment

describe('trimSegmentEdges', () => {
  it('removes the blank line left where a quote pointer was', () => {
    // "words\n\n" + [pointer removed].
    expect(trimSegmentEdges([text('Best Nostr client. And the fastest!\n\n')])).toEqual([
      text('Best Nostr client. And the fastest!'),
    ])
  })

  it('drops a segment that was nothing but the whitespace around the pointer', () => {
    expect(trimSegmentEdges([text('words'), text('\n\n')])).toEqual([text('words')])
  })

  it('KEEPS the author own blank line between paragraphs', () => {
    const body = text('one\n\ntwo')
    expect(trimSegmentEdges([body])).toEqual([body])
  })

  it('trims a leading blank too, for a note that opened with the pointer', () => {
    expect(trimSegmentEdges([text('\n\n'), text('after')])).toEqual([text('after')])
  })

  it('leaves a non-text segment at the edge alone', () => {
    const only = [event()]
    expect(trimSegmentEdges(only)).toEqual(only)
  })

  it('survives an empty list', () => {
    expect(trimSegmentEdges([])).toEqual([])
  })
})
