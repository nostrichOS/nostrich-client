'use client'

import type { RelayStatus } from '@nostrich/nostr'

import { tallyRelays, useRelayStatus } from '../lib/relay-status'

const STATE_LABEL: Record<RelayStatus['state'], string> = {
  open: 'connected',
  connecting: 'connecting',
  closed: 'disconnected',
  failed: 'failed',
}

function dotClass(state: RelayStatus['state']): string {
  switch (state) {
    case 'open':
      return 'bg-success'
    case 'connecting':
      return 'bg-warning'
    case 'failed':
      return 'bg-danger'
    case 'closed':
      return 'bg-text-faint'
  }
}

/** How much of the network we are actually reading. */
export function RelayStatusPanel(): React.ReactNode {
  const statuses = useRelayStatus()
  const tally = tallyRelays(statuses)

  const summaryState: RelayStatus['state'] =
    tally.open > 0 ? 'open' : tally.connecting > 0 ? 'connecting' : 'failed'

  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2 text-sm text-text-muted hover:bg-bg-inset hover:text-text">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dotClass(summaryState)}`} />
        <span className="tabular-nums">
          {tally.open}/{tally.total === 0 ? '0' : tally.total}
        </span>
        <span className="sr-only">relays connected. Open for per-relay detail.</span>
        <span aria-hidden="true" className="hidden sm:inline">
          relays
        </span>
      </summary>

      <div className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-bg-elevated p-3 shadow-lg">
        <p className="mb-2 text-xs text-text-muted">
          {tally.total === 0
            ? 'Connecting to relays…'
            : `Reading from ${tally.open} of ${tally.total} relays. A partial connection means a partial view of the network.`}
        </p>
        <ul className="space-y-1">
          {statuses.map(status => (
            <li key={status.url} className="flex items-center gap-2 text-xs">
              <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dotClass(status.state)}`} />
              <span className="min-w-0 flex-1 truncate font-mono text-text" title={status.url}>
                {status.url}
              </span>
              <span className="shrink-0 text-text-faint">
                {status.state === 'open' && status.latencyMs !== undefined
                  ? `${status.latencyMs} ms`
                  : STATE_LABEL[status.state]}
              </span>
            </li>
          ))}
        </ul>
        {statuses.some(status => status.error !== undefined) ? (
          <ul className="mt-2 space-y-1 border-t border-border pt-2">
            {statuses
              .filter(status => status.error !== undefined)
              .map(status => (
                <li key={`${status.url}-error`} className="text-xs text-danger-text">
                  <span className="font-mono">{status.url}</span>: {status.error}
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </details>
  )
}
