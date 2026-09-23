'use client'

import { parseMarkdown, type Block, type Span } from '../lib/markdown'
import { ContentLink } from './ContentLink'

/** A parsed article, drawn. */
export function MarkdownBody({ source }: { source: string }): React.ReactNode {
  /* Article text scales with the reader's text-size setting. */
  const blocks = parseMarkdown(source)
  return (
    <div className="space-y-5">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  )
}

function BlockView({ block }: { block: Block }): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      // One step down from the article title at every level, so the page has a single.
      const size =
        block.level === 1
          ? 'mt-8 text-2xl'
          : block.level === 2
            ? 'mt-8 text-xl'
            : block.level === 3
              ? 'mt-6 text-lg'
              : 'mt-6 text-base'
      return (
        <h2 className={`${size} font-bold leading-snug text-text`}>
          <Spans spans={block.spans} />
        </h2>
      )
    }

    case 'paragraph':
      // 17px and 1.75 leading.
      return (
        <p className="text-[calc(17px*var(--content-scale,1))] leading-[1.75] text-text">
          <Spans spans={block.spans} />
        </p>
      )

    case 'quote':
      return (
        <blockquote className="border-l-4 border-border pl-4 text-[calc(17px*var(--content-scale,1))] italic leading-[1.75] text-text-muted">
          <Spans spans={block.spans} />
        </blockquote>
      )

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          className={`space-y-2 pl-6 text-[calc(17px*var(--content-scale,1))] leading-[1.75] text-text ${
            block.ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {block.items.map((item, index) => (
            <li key={index}>
              <Spans spans={item} />
            </li>
          ))}
        </Tag>
      )
    }

    case 'code':
      return (
        /** Scrolls sideways rather than wrapping, and is capped in height. */
        <pre className="max-h-96 overflow-auto rounded-lg bg-bg-inset p-4 text-[13px] leading-relaxed text-text-muted">
          <code>{block.code}</code>
        </pre>
      )

    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
        <img
          src={block.url}
          alt={block.alt}
          loading="lazy"
          decoding="async"
          // Someone else's server.
          referrerPolicy="no-referrer"
          className="h-auto w-full rounded-xl bg-bg-inset object-contain"
        />
      )

    case 'rule':
      return <hr className="border-border" />

    default:
      return null
  }
}

function Spans({ spans }: { spans: Span[] }): React.ReactNode {
  return (
    <>
      {spans.map((span, index) => {
        switch (span.type) {
          case 'bold':
            return (
              <strong key={index} className="font-bold text-text">
                {span.text}
              </strong>
            )
          case 'bolditalic':
            return (
              <strong key={index} className="font-bold italic text-text">
                {span.text}
              </strong>
            )
          case 'italic':
            return (
              <em key={index} className="italic">
                {span.text}
              </em>
            )
          case 'code':
            return (
              <code
                key={index}
                className="rounded-sm bg-bg-inset px-1 py-0.5 text-[0.9em] text-text-muted"
              >
                {span.text}
              </code>
            )
          case 'link':
            // Through ContentLink, so an author's link is subject to the same rules as any other.
            return (
              <ContentLink key={index} href={span.href} className="text-link hover:underline">
                {span.text}
              </ContentLink>
            )
          default:
            return <span key={index}>{span.text}</span>
        }
      })}
    </>
  )
}
