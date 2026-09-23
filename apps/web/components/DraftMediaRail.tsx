'use client'

import { useRef, useState } from 'react'

/** Attachments in the composer, laid out the way the posted note will lay them out. */
export function DraftMediaRail({ children }: { children: React.ReactNode[] }): React.ReactNode {
  const ref = useRef<HTMLUListElement>(null)
  const [offset, setOffset] = useState(0)
  const [viewport, setViewport] = useState(0)
  const [content, setContent] = useState(0)

  // A pixel of slack at each end: fractional scroll offsets are normal, and an arrow.
  const canLeft = offset > 1
  const canRight = content - viewport - offset > 1

  const nudge = (direction: 1 | -1): void => {
    const node = ref.current
    if (node === null) return
    // A little less than a full viewport, so the item at the edge stays partly visible.
    const step = Math.max(1, node.clientWidth * 0.8)
    node.scrollTo({ left: Math.max(0, node.scrollLeft + direction * step), behavior: 'smooth' })
  }

  // One attachment is not a rail.
  if (children.length <= 1) return <ul className="mt-2 space-y-2">{children}</ul>

  return (
    <div className="relative mt-2">
      <ul
        /* One ref doing both jobs: holding the node for `nudge`, and measuring. */
        ref={node => {
          ref.current = node
          if (node === null) return
          setViewport(node.clientWidth)
          setContent(node.scrollWidth)
        }}
        className="no-scrollbar flex gap-2 overflow-x-auto"
        onScroll={event => {
          setOffset(event.currentTarget.scrollLeft)
          // Re-measured on scroll as well: a picture that loads after mount changes the content.
          setContent(event.currentTarget.scrollWidth)
        }}
      >
        {children.map((child, index) => (
          // Narrower than the column on purpose: the next item peeking in at the right edge.
          <li key={index} className="w-[260px] shrink-0">
            {child}
          </li>
        ))}
      </ul>

      {canLeft ? <RailArrow direction="left" onClick={() => nudge(-1)} /> : null}
      {canRight ? <RailArrow direction="right" onClick={() => nudge(1)} /> : null}
    </div>
  )
}

/** The same dark disc the posted note uses, and the same reasoning: it sits. */
function RailArrow({
  direction,
  onClick,
}: {
  direction: 'left' | 'right'
  onClick: () => void
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === 'left' ? 'Previous attachment' : 'More attachments'}
      className={`absolute top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/60 ${
        direction === 'left' ? 'left-2' : 'right-2'
      }`}
    >
      {/* Drawn, not typed. */}
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={direction === 'left' ? 'M14.5 6 8.5 12l6 6' : 'M9.5 6l6 6-6 6'} />
      </svg>
    </button>
  )
}
