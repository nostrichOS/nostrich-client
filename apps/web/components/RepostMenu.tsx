'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/** Repost, or quote. */

const MENU_WIDTH = 184

export function RepostMenu({
  at,
  reposted,
  onRepost,
  onQuote,
  onClose,
}: {
  /** Where the press landed, in viewport coordinates. */
  at: { x: number; y: number }
  /** Already reposted by this reader, so the first item undoes it instead. */
  reposted: boolean
  onRepost: () => void
  onQuote: () => void
  onClose: () => void
}): React.ReactNode {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    /** Scrolling CLOSES this one rather than moving. */
    const onScroll = (): void => onClose()
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* A transparent full-screen layer, so a click anywhere dismisses without that click. */}
      <div className="fixed inset-0 z-[90]" onClick={onClose} onContextMenu={onClose} />
      <div
        role="menu"
        aria-label="Repost options"
        style={{
          left: Math.max(8, Math.min(at.x - 12, window.innerWidth - MENU_WIDTH - 8)),
          // Above the press when there is no room below, so the menu is never off-screen.
          ...(at.y + 130 < window.innerHeight
            ? { top: at.y + 10 }
            : { bottom: window.innerHeight - at.y + 10 }),
          width: MENU_WIDTH,
        }}
        className="fixed z-[100] overflow-hidden rounded-2xl border border-border bg-bg-elevated py-1 shadow-lg"
      >
        <MenuItem
          label={reposted ? 'Undo repost' : 'Repost'}
          onClick={() => {
            onRepost()
            onClose()
          }}
          icon={
            <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 2l4 4-4 4" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <path d="M7 22l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          }
        />
        <MenuItem
          label="Quote"
          onClick={() => {
            onQuote()
            onClose()
          }}
          icon={
            <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          }
        />
      </div>
    </>,
    document.body,
  )
}

function MenuItem({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
}): React.ReactNode {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={event => {
        // The card below is clickable.
        event.stopPropagation()
        onClick()
      }}
      className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-[15px] font-bold text-text transition-colors hover:bg-bg-inset"
    >
      <span className="shrink-0 text-text">{icon}</span>
      {label}
    </button>
  )
}
