/** What the writer typed, turned into the Markdown NIP-23 requires. */

/** Characters that would otherwise be read as Markdown syntax when the author meant. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1')
}

function isBlock(node: Element): boolean {
  return /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|HR|BR|TABLE|TR|SECTION|ARTICLE)$/.test(node.tagName)
}

/** Inline content of a node, as Markdown. */
function inline(node: Node): string {
  if (node.nodeType === 3) {
    // Collapse the whitespace the browser preserves between tags.
    return escapeText((node.textContent ?? '').replace(/\s+/g, ' '))
  }
  if (node.nodeType !== 1) return ''

  const element = node as Element
  const children = [...element.childNodes].map(inline).join('')

  switch (element.tagName) {
    case 'STRONG':
    case 'B':
      return children.trim() === '' ? children : `**${children}**`
    case 'EM':
    case 'I':
      return children.trim() === '' ? children : `*${children}*`
    case 'CODE':
      // Never escaped: the point of code is that its characters are literal.
      return `\`${element.textContent ?? ''}\``
    case 'A': {
      const href = element.getAttribute('href') ?? ''
      return href === '' ? children : `[${children}](${href})`
    }
    case 'IMG': {
      const src = element.getAttribute('src') ?? ''
      const alt = element.getAttribute('alt') ?? ''
      return src === '' ? '' : `![${alt}](${src})`
    }
    case 'BR':
      return '\n'
    default:
      return children
  }
}

/** One block element, as one Markdown block. */
function block(element: Element): string {
  const tag = element.tagName

  if (tag === 'HR') return '---'
  if (tag === 'PRE') return `\`\`\`\n${element.textContent ?? ''}\n\`\`\``

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1))
    const text = inline(element).trim()
    return text === '' ? '' : `${'#'.repeat(level)} ${text}`
  }

  if (tag === 'BLOCKQUOTE') {
    return walk(element)
      .split('\n\n')
      .map(part => part.split('\n').map(line => `> ${line}`).join('\n'))
      .join('\n>\n')
  }

  if (tag === 'UL' || tag === 'OL') {
    const ordered = tag === 'OL'
    return [...element.children]
      .filter(child => child.tagName === 'LI')
      .map((item, index) => `${ordered ? `${index + 1}.` : '-'} ${inline(item).trim()}`)
      .join('\n')
  }

  const text = inline(element).trim()
  return text
}

/** Depth-first over block elements, gathering loose inline content as it goes. */
function walk(root: Node): string {
  const out: string[] = []
  let loose = ''

  const flush = (): void => {
    const text = loose.trim()
    loose = ''
    if (text !== '') out.push(text)
  }

  for (const child of [...root.childNodes]) {
    if (child.nodeType === 1 && isBlock(child as Element)) {
      flush()
      const element = child as Element
      // A DIV is a line wrapper in a contenteditable, not a section.
      const rendered =
        element.tagName === 'DIV' || element.tagName === 'SECTION' || element.tagName === 'ARTICLE'
          ? [...element.children].some(node => isBlock(node))
            ? walk(element)
            : block(element)
          : block(element)
      if (rendered.trim() !== '') out.push(rendered)
      continue
    }
    loose += inline(child)
  }

  flush()
  return out.join('\n\n')
}

/** Rich-text HTML to Markdown. */
export function htmlToMarkdown(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return walk(parsed.body)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Words in rich text, for the count and the reading estimate. */
export function textOf(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')

  const collect = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? ''
    if (node.nodeType !== 1) return ''
    const element = node as Element
    if (element.tagName === 'BR') return ' '
    const inner = [...element.childNodes].map(collect).join('')
    // A block boundary is a word boundary, whatever the markup did with the whitespace.
    return isBlock(element) ? ` ${inner} ` : inner
  }

  return collect(parsed.body).replace(/\s+/g, ' ').trim()
}
