'use client'

import { useRouter } from 'next/navigation'

/** `← Articles`, `← Note`. */
export function BackBar({
  label,
  href,
  actions,
  onBack,
}: {
  label: string
  href: string
  /** Handle "back" here instead of navigating. */
  onBack?: () => void
  /** Rendered at the right of the same row. */
  actions?: React.ReactNode
}): React.ReactNode {
  const router = useRouter()

  return (
    /** Sticky, at the same offset the rails use. */
    /* `top-16` on mobile, because something is already there. */
    /* NO BOTTOM MARGIN. */
    <div className="sticky top-16 z-20 -mx-4 flex items-center justify-between gap-3 border-b border-border bg-bg/85 px-4 py-2.5 backdrop-blur sm:top-0 sm:-mx-5 sm:px-5">
      <button
        type="button"
        /* A hook for the native shell, and nothing else. */
        data-shell-back=""
        onClick={() => {
          if (onBack !== undefined) {
            onBack()
            return
          }
          // `history.length > 1` is the only signal a browser gives about whether there.
          if (typeof window !== 'undefined' && window.history.length > 1) router.back()
          else router.push(href)
        }}
        /* Three things have to be true at once, and each earlier attempt satisfied two. */
        className="-ml-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-[17px] font-bold text-text transition-colors hover:bg-hover"
      >
        <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
          arrow_back
        </span>
        {label}
      </button>

      {actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
