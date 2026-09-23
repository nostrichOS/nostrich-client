'use client'

import { useEffect } from 'react'

import { ContentLink } from './ContentLink'
import { dismissZapOutcome, useZapOutcome } from '../lib/outcome'

/** The one thing a backgrounded zap still has to say out loud. */
const HOLD_MS = { error: 9_000, warning: 6_000 } as const
const HOLD_ACTIONABLE_MS = 45_000

export function ZapOutcomeToast(): React.ReactNode {
  const outcome = useZapOutcome()

  useEffect(() => {
    if (outcome === undefined) return
    const hold = outcome.action === undefined ? HOLD_MS[outcome.tone] : HOLD_ACTIONABLE_MS
    const timer = setTimeout(() => dismissZapOutcome(outcome.id), hold)
    return () => clearTimeout(timer)
    // Keyed on the id, so an identical message announced twice restarts the clock.
  }, [outcome?.id, outcome?.tone, outcome])

  if (outcome === undefined) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(var(--bottom-nav-h)+12px+var(--bottom-nav-inset))] left-1/2 z-[100] w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 sm:bottom-5 sm:left-5 sm:translate-x-0"
    >
      <div
        className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-[14.5px] leading-snug shadow-lg ${
          outcome.tone === 'error'
            ? 'bg-danger-surface text-danger-text'
            : 'bg-warning-surface text-warning-text'
        }`}
      >
        <span className="material-symbols-outlined mt-px text-[18px]!" aria-hidden="true">
          {outcome.tone === 'error' ? 'error' : 'warning'}
        </span>
        <span className="min-w-0 flex-1">
          {outcome.message}
          {outcome.action !== undefined ? (
            <ContentLink
              href={outcome.action.href}
              onClick={() => dismissZapOutcome(outcome.id)}
              className="ml-2 inline-block rounded-full border border-current/35 px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap hover:border-current/70"
            >
              {outcome.action.label}
            </ContentLink>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => dismissZapOutcome(outcome.id)}
          aria-label="Dismiss"
          className="-mr-1 shrink-0 cursor-pointer rounded-full p-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        </button>
      </div>
    </div>
  )
}
