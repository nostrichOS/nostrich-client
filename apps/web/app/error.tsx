'use client'

import { BUTTON_PRIMARY, CARD } from '../lib/styles'

/** Everything on this page is driven by data from strangers over websockets. */
export default function ErrorScreen({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className={`${CARD} space-y-3 px-5 py-6`}>
      <h1 className="text-lg font-semibold text-text">Something broke while rendering the feed</h1>
      <p className="text-sm text-text-muted">
        Nothing was lost. Nostrich stores nothing locally beyond your theme and session choice.
      </p>
      {error.message === '' ? null : (
        <p className="rounded-md bg-bg-inset px-3 py-2 font-mono text-xs text-text-muted">{error.message}</p>
      )}
      <button type="button" onClick={reset} className={BUTTON_PRIMARY}>
        Try again
      </button>
    </div>
  )
}
