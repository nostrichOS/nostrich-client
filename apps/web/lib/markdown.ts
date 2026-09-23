/** Enough Markdown to read a NIP-23 article, and nothing more. */

export type Span =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  /** `***both***`. */
  | { type: 'bolditalic'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; spans: Span[] }
  | { type: 'paragraph'; spans: Span[] }
  | { type: 'quote'; spans: Span[] }
  | { type: 'list'; ordered: boolean; items: Span[][] }
  | { type: 'code'; language: string; code: string }
  | { type: 'image'; url: string; alt: string }
  | { type: 'rule' }

/** A trailing backslash is a line break, not a character. */
function stripLineBreaks(line: string): string {
  return line.replace(/\\+$/, '')
}

/** Raw HTML, reduced to its text. */
function stripTags(line: string): string {
  return line.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim()
}

const IMAGE_ONLY = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)$/
const HEADING = /^(#{1,6})\s+(.*)$/
const UNORDERED = /^[-*+]\s+(.*)$/
const ORDERED = /^\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const RULE = /^(-{3,}|\*{3,}|_{3,})$/

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flush = (): void => {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ').trim()
    paragraph = []
    if (text !== '') blocks.push({ type: 'paragraph', spans: parseInline(text) })
  }

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    const line = stripLineBreaks(raw)
    const trimmed = line.trim()

    // Fenced code, taken verbatim to the closing fence.
    const fence = /^```+\s*(\S*)/.exec(trimmed)
    if (fence !== null) {
      flush()
      const language = fence[1] ?? ''
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```/.test((lines[i] ?? '').trim())) {
        body.push(lines[i] ?? '')
        i += 1
      }
      blocks.push({ type: 'code', language, code: body.join('\n') })
      continue
    }

    if (trimmed === '') {
      flush()
      continue
    }

    if (RULE.test(trimmed)) {
      flush()
      blocks.push({ type: 'rule' })
      continue
    }

    const image = IMAGE_ONLY.exec(trimmed)
    if (image !== null) {
      flush()
      blocks.push({ type: 'image', url: image[2] ?? '', alt: image[1] ?? '' })
      continue
    }

    const heading = HEADING.exec(trimmed)
    if (heading !== null) {
      flush()
      const hashes = (heading[1] ?? '#').length
      blocks.push({
        type: 'heading',
        // Beyond four there is no visual room left to distinguish them in a column this wide.
        level: (hashes > 4 ? 4 : hashes) as 1 | 2 | 3 | 4,
        spans: parseInline(heading[2] ?? ''),
      })
      continue
    }

    const quote = QUOTE.exec(trimmed)
    if (quote !== null) {
      flush()
      blocks.push({ type: 'quote', spans: parseInline(quote[1] ?? '') })
      continue
    }

    const bullet = UNORDERED.exec(trimmed)
    const numbered = ORDERED.exec(trimmed)
    if (bullet !== null || numbered !== null) {
      flush()
      const ordered = numbered !== null
      const items: Span[][] = []
      let cursor = i
      while (cursor < lines.length) {
        const next = stripLineBreaks(lines[cursor] ?? '').trim()
        const match = ordered ? ORDERED.exec(next) : UNORDERED.exec(next)
        if (match === null) break
        items.push(parseInline(match[1] ?? ''))
        cursor += 1
      }
      blocks.push({ type: 'list', ordered, items })
      i = cursor - 1
      continue
    }

    const text = stripTags(line)
    if (text !== '') paragraph.push(text)
  }

  flush()
  return blocks
}

/** Inline marks, resolved left to right with no nesting. */
export function parseInline(source: string): Span[] {
  const spans: Span[] = []
  let rest = source
  // Order matters: code, then links (which may contain brackets), then bold-italic.
  const patterns: { re: RegExp; make: (m: RegExpExecArray) => Span }[] = [
    { re: /`([^`]+)`/, make: m => ({ type: 'code', text: m[1] ?? '' }) },
    {
      re: /\[([^\]]*)\]\(([^)\s]+)[^)]*\)/,
      make: m => ({ type: 'link', text: m[1] ?? '', href: m[2] ?? '' }),
    },
    /** `***both***`, which must be tried BEFORE `**`. */
    { re: /\*\*\*(\S[^*]*?)\*\*\*/, make: m => ({ type: 'bolditalic', text: m[1] ?? '' }) },
    { re: /___(\S[^_]*?)___/, make: m => ({ type: 'bolditalic', text: m[1] ?? '' }) },
    { re: /\*\*(\S[^*]*?)\*\*/, make: m => ({ type: 'bold', text: m[1] ?? '' }) },
    { re: /__(\S[^_]*?)__/, make: m => ({ type: 'bold', text: m[1] ?? '' }) },
    /** No space after the opening marker, which is what Markdown actually requires. */
    { re: /\*(\S[^*]*?)\*/, make: m => ({ type: 'italic', text: m[1] ?? '' }) },
    /** Single-underscore italics are NOT parsed, deliberately. */
  ]

  // A bare URL is a link even without brackets.
  const bare = /https?:\/\/[^\s<>"')]+/

  while (rest !== '') {
    let best: { index: number; length: number; span: Span } | undefined
    for (const { re, make } of patterns) {
      const match = re.exec(rest)
      if (match === null) continue
      if (best === undefined || match.index < best.index) {
        best = { index: match.index, length: match[0].length, span: make(match) }
      }
    }
    const url = bare.exec(rest)
    if (url !== null && (best === undefined || url.index < best.index)) {
      best = {
        index: url.index,
        length: url[0].length,
        span: { type: 'link', text: url[0], href: url[0] },
      }
    }

    if (best === undefined) {
      spans.push({ type: 'text', text: rest })
      break
    }
    if (best.index > 0) spans.push({ type: 'text', text: rest.slice(0, best.index) })
    spans.push(best.span)
    rest = rest.slice(best.index + best.length)
  }

  return spans.filter(span => span.type !== 'text' || span.text !== '')
}

/** Roughly how long this takes to read, in minutes. */
export function readingMinutes(source: string): number {
  const words = parseMarkdown(source)
    .flatMap(block => {
      if (block.type === 'code' || block.type === 'image' || block.type === 'rule') return []
      if (block.type === 'list') return block.items.flat()
      return block.spans
    })
    .map(span => span.text)
    .join(' ')
    .split(/\s+/)
    .filter(word => word.length > 0).length
  return Math.max(1, Math.round(words / 200))
}
