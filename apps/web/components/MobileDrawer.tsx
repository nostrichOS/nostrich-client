'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import type { Hex } from '@nostrich/nostr'

import { closesDrawer } from '../lib/swipe-close'
import { AccountBlock, NAV_ITEMS, navHref } from './LeftRail'

/** The phone's main menu, as a drawer. */
export function MobileDrawer({
  open,
  onClose,
  pubkey,
  anyWidth = false,
}: {
  open: boolean
  onClose: () => void
  pubkey: Hex | undefined
  /** Let it open at ANY width, not just below `sm`. */
  anyWidth?: boolean
}): React.ReactNode {
  const hideAboveSm = anyWidth ? '' : 'sm:hidden'
  const pathname = usePathname()

  /** Escape closes it, and the page behind does not scroll while it is open. */
  /** A switched account closes the menu. */
  const lastPubkey = useRef<Hex | undefined>(pubkey)
  useEffect(() => {
    if (lastPubkey.current === pubkey) return
    lastPubkey.current = pubkey
    if (open) onClose()
  }, [pubkey, open, onClose])

  /** SWIPE IT AWAY, which is the other half of the swipe that opened. */
  const from = useRef<{ x: number; y: number } | null>(null)

  const onTouchStart = (event: React.TouchEvent): void => {
    // A second finger means a pinch or a stray palm, not a swipe.
    if (event.touches.length !== 1) {
      from.current = null
      return
    }
    const touch = event.touches[0]
    from.current = touch === undefined ? null : { x: touch.clientX, y: touch.clientY }
  }

  const onTouchEnd = (event: React.TouchEvent): void => {
    const started = from.current
    from.current = null
    if (started === null) return
    const touch = event.changedTouches[0]
    if (touch === undefined) return
    /* Leftward and far enough, and straighter than the scroll it must not be confused. */
    if (closesDrawer(touch.clientX - started.x, touch.clientY - started.y)) onClose()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const held = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = held
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <>
      {/* The scrim. */}
      <button
        type="button"
        aria-hidden={!open}
        tabIndex={-1}
        onClick={onClose}
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-200 ${hideAboveSm} ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        /* A cancelled touch is the OS taking the gesture. */
        onTouchCancel={() => {
          from.current = null
        }}
        /* `translate-x` rather than mounting and unmounting: a transform animates. */
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(300px,85vw)] flex-col border-r border-border bg-bg transition-transform duration-200 ease-out ${hideAboveSm} ${
          open ? 'translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-xl font-bold text-text">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex size-9 cursor-pointer items-center justify-center rounded-full text-text transition-colors hover:bg-bg-inset"
          >
            <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        {/* The menu scrolls. */}
        <nav aria-label="All sections" className="min-h-0 flex-1 overflow-y-auto py-2">
          <ul>
            {NAV_ITEMS.map(item => {
              const active =
                item.href === '/'
                  ? pathname === '/'
                  : item.href === '/profile'
                    ? pathname.startsWith('/p/')
                    : pathname.startsWith(item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={navHref(item, pubkey)}
                    onClick={onClose}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-4 px-4 py-3 text-lg transition-colors hover:bg-bg-inset ${
                      active ? 'font-bold text-text' : 'font-normal text-text-muted'
                    }`}
                  >
                    {/* The same two icon paths the rail uses: an `svg` when the item carries one. */}
                    <span className="flex shrink-0 items-center text-nav-icon">
                      {item.svg === undefined ? (
                        <span className="material-symbols-outlined text-[26px]!" aria-hidden="true">
                          {item.icon}
                        </span>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          className="size-[24px]"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d={item.svg} />
                        </svg>
                      )}
                    </span>
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>

        </nav>

        {/* The account switcher, at the bottom. */}
        {pubkey === undefined ? (
          <div className="border-t border-border p-4">
            <Link
              href="/login"
              onClick={onClose}
              className="block rounded-full bg-text px-4 py-2.5 text-center text-[15px] font-bold text-bg transition-opacity hover:opacity-90"
            >
              Sign In
            </Link>
          </div>
        ) : (
          <div className="border-t border-border p-2">
            {/* `expanded`, because this drawer is 300px wide by definition. */}
            <AccountBlock pubkey={pubkey} expanded />
          </div>
        )}
      </div>
    </>
  )
}
