import { describe, expect, it } from 'vitest'

import { htmlToMarkdown, textOf } from './html-to-markdown'

/** What the writer sees, and what the network gets. */

describe('blocks', () => {
  it('turns paragraphs into blank-line-separated text', () => {
    expect(htmlToMarkdown('<p>One.</p><p>Two.</p>')).toBe('One.\n\nTwo.')
  })

  it('carries heading levels', () => {
    expect(htmlToMarkdown('<h2>Title</h2><h3>Sub</h3>')).toBe('## Title\n\n### Sub')
  })

  it('writes bullet and numbered lists', () => {
    expect(htmlToMarkdown('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b')
    expect(htmlToMarkdown('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b')
  })

  it('prefixes every line of a quote', () => {
    expect(htmlToMarkdown('<blockquote><p>a</p><p>b</p></blockquote>')).toBe('> a\n>\n> b')
  })

  it('fences a code block and leaves its characters alone', () => {
    expect(htmlToMarkdown('<pre><code>a * b_c</code></pre>')).toBe('```\na * b_c\n```')
  })

  it('writes a rule', () => {
    expect(htmlToMarkdown('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb')
  })
})

describe('inline formatting', () => {
  it('keeps bold and italic', () => {
    expect(htmlToMarkdown('<p><strong>a</strong> and <em>b</em></p>')).toBe('**a** and *b*')
  })

  /** Nested marks must survive as both, not as whichever was noticed first. */
  it('keeps bold inside italic', () => {
    expect(htmlToMarkdown('<p><em><strong>a</strong></em></p>')).toBe('***a***')
  })

  it('keeps links and their text', () => {
    expect(htmlToMarkdown('<p>see <a href="https://x.com/y">this</a></p>')).toBe(
      'see [this](https://x.com/y)',
    )
  })

  it('keeps images with their alt text', () => {
    expect(htmlToMarkdown('<p><img src="https://i/x.png" alt="a cat"></p>')).toBe(
      '![a cat](https://i/x.png)',
    )
  })

  it('does not escape inside inline code', () => {
    expect(htmlToMarkdown('<p><code>a_b*c</code></p>')).toBe('`a_b*c`')
  })

  /** A hard break is a break. */
  it('keeps a hard break', () => {
    expect(htmlToMarkdown('<p>a<br>b</p>')).toBe('a\nb')
  })
})

/** The asterisk problem. */
describe('text that looks like syntax', () => {
  it('escapes characters Markdown would otherwise claim', () => {
    expect(htmlToMarkdown('<p>5 * 3 and _x_ and [y]</p>')).toBe(
      '5 \\* 3 and \\_x\\_ and \\[y\\]',
    )
  })

  it('escapes a backslash so it survives as one', () => {
    expect(htmlToMarkdown('<p>a\\b</p>')).toBe('a\\\\b')
  })
})

/** Paste, which is the case that decides whether this is usable. */
describe('pasted markup', () => {
  it('reads a div-wrapped paragraph as a paragraph', () => {
    expect(htmlToMarkdown('<div>a</div><div>b</div>')).toBe('a\n\nb')
  })

  it('sees through wrapper spans and styles', () => {
    expect(
      htmlToMarkdown('<p><span style="font-weight:700"><b>Hi</b></span> <span>there</span></p>'),
    ).toBe('**Hi** there')
  })

  it('keeps the text of an element it has no Markdown for', () => {
    // A table has no representation here.
    expect(htmlToMarkdown('<table><tr><td>kept</td></tr></table>')).toContain('kept')
  })

  it('collapses the whitespace an editor leaves between tags', () => {
    expect(htmlToMarkdown('<p>a\n   b</p>')).toBe('a b')
  })

  /** Nothing pasted may become live markup. */
  it('does not carry a script through', () => {
    const out = htmlToMarkdown('<p>a</p><script>alert(1)</script>')
    expect(out).not.toContain('<script')
    expect(out.startsWith('a')).toBe(true)
  })
})

describe('the empty document', () => {
  /** ProseMirror keeps one empty paragraph, which is not the empty string. */
  it('reports an untouched editor as empty', () => {
    expect(textOf('<p></p>')).toBe('')
    expect(htmlToMarkdown('<p></p>')).toBe('')
    expect(htmlToMarkdown('<p><br></p>')).toBe('')
  })

  it('counts only the prose', () => {
    expect(textOf('<h2>Two words</h2><p><strong>here</strong> now</p>')).toBe('Two words here now')
  })
})
