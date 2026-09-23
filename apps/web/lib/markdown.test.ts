import { describe, expect, it } from 'vitest'

import { parseInline, parseMarkdown, readingMinutes } from './markdown'

/** The cases that made real articles unreadable, pinned. */

describe('parseMarkdown', () => {
  it('reads a heading as a heading, not as text with a hash on it', () => {
    const [block] = parseMarkdown('# Open for Comment')
    expect(block).toEqual({ type: 'heading', level: 1, spans: [{ type: 'text', text: 'Open for Comment' }] })
  })

  it('caps heading depth where the design runs out of sizes', () => {
    const [block] = parseMarkdown('###### deep')
    expect(block?.type === 'heading' && block.level).toBe(4)
  })

  /** The backslash-per-line style several publishing tools emit. */
  it('drops trailing backslashes used as line breaks', () => {
    const blocks = parseMarkdown('first line\\\nsecond line\\')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type === 'paragraph' && blocks[0].spans[0]?.text).toBe('first line second line')
  })

  it('keeps fenced code verbatim and does not read syntax inside it', () => {
    const [block] = parseMarkdown('```json\n{\n  "# not": "**a heading**"\n}\n```')
    expect(block).toEqual({
      type: 'code',
      language: 'json',
      code: '{\n  "# not": "**a heading**"\n}',
    })
  })

  /** Raw HTML is never rendered as HTML, and never shown with its brackets either. */
  it('reduces raw HTML to the text it wrapped', () => {
    const [block] = parseMarkdown('<details><summary>Structured Data</summary>')
    expect(block?.type === 'paragraph' && block.spans[0]?.text).toBe('Structured Data')
  })

  it('never emits markup for a script tag', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>')
    const text = JSON.stringify(blocks)
    expect(text).not.toContain('<script')
  })

  it('reads a rule, a quote and both kinds of list', () => {
    expect(parseMarkdown('---')[0]).toEqual({ type: 'rule' })
    expect(parseMarkdown('> quoted')[0]?.type).toBe('quote')
    const bullets = parseMarkdown('- one\n- two')[0]
    expect(bullets?.type === 'list' && bullets.ordered).toBe(false)
    expect(bullets?.type === 'list' && bullets.items).toHaveLength(2)
    const numbered = parseMarkdown('1. one\n2. two')[0]
    expect(numbered?.type === 'list' && numbered.ordered).toBe(true)
  })

  it('takes a standalone image out of the prose', () => {
    const [block] = parseMarkdown('![a cat](https://example.com/cat.jpg)')
    expect(block).toEqual({ type: 'image', url: 'https://example.com/cat.jpg', alt: 'a cat' })
  })

  it('joins wrapped lines into one paragraph', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree')
    expect(blocks).toHaveLength(2)
  })
})

describe('parseInline', () => {
  it('reads bold and italic without their markers', () => {
    expect(parseInline('**Type**: x')).toEqual([
      { type: 'bold', text: 'Type' },
      { type: 'text', text: ': x' },
    ])
    expect(parseInline('*soft*')).toEqual([{ type: 'italic', text: 'soft' }])
  })

  /** `**` must not be read as two empty italics. */
  it('prefers bold over italic', () => {
    expect(parseInline('**both**')).toEqual([{ type: 'bold', text: 'both' }])
  })

  it('reads a markdown link', () => {
    expect(parseInline('[fr](https://federalregister.gov)')).toEqual([
      { type: 'link', text: 'fr', href: 'https://federalregister.gov' },
    ])
  })

  it('reads a bare URL, which is how people actually paste them', () => {
    expect(parseInline('see https://example.com now')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', text: 'https://example.com', href: 'https://example.com' },
      { type: 'text', text: ' now' },
    ])
  })

  /** Code wins, and its contents are never re-examined. */
  it('leaves markers alone inside code', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ type: 'code', text: '**not bold**' }])
  })

  it('leaves unmatched markers as text', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }])
  })

  /** Single underscores are not emphasis here. */
  it('does not italicise the middle of an identifier', () => {
    expect(parseInline('snake_case_name')).toEqual([{ type: 'text', text: 'snake_case_name' }])
  })
})

describe('readingMinutes', () => {
  it('is never zero', () => {
    expect(readingMinutes('hi')).toBe(1)
  })

  it('counts prose at 200 words a minute', () => {
    expect(readingMinutes('word '.repeat(600))).toBe(3)
  })

  /** A page of fenced JSON is not an hour of reading. */
  it('ignores code blocks', () => {
    expect(readingMinutes('```\n' + 'token '.repeat(2000) + '\n```\nshort')).toBe(1)
  })
})

/** `***both***`, which the deployed renderer got wrong. */
describe('bold italic', () => {
  it('reads three asterisks as one span', () => {
    expect(parseInline('***a***')).toEqual([{ type: 'bolditalic', text: 'a' }])
  })

  it('reads three underscores the same way', () => {
    expect(parseInline('___a___')).toEqual([{ type: 'bolditalic', text: 'a' }])
  })

  it('leaves no stray asterisk beside surrounding words', () => {
    expect(parseInline('say ***a*** now')).toEqual([
      { type: 'text', text: 'say ' },
      { type: 'bolditalic', text: 'a' },
      { type: 'text', text: ' now' },
    ])
  })

  it('still reads two and one as bold and italic', () => {
    expect(parseInline('**a**')).toEqual([{ type: 'bold', text: 'a' }])
    expect(parseInline('*a*')).toEqual([{ type: 'italic', text: 'a' }])
  })
})
