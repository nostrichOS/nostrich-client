'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useStoredRelays } from '../lib/relay-apply'
import { useState, type ReactNode } from 'react'

import { ThemeProvider } from '@nostrich/app'

import { ClockProvider } from './Clock'
import { SessionProvider } from './SessionProvider'

/** The relay list, applied. */
function StoredRelays(): null {
  useStoredRelays()
  return null
}

export function Providers({ children }: { children: ReactNode }): ReactNode {
  // Held in state, not module scope: a module-level client is shared across requests.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Every query here ends at a relay or a stranger's web server, and retrying.
            retry: false,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        {/* Required by every component from @nostrich/app. */}
        <ThemeProvider theme="light">
          {/* Hands the reader's stored relay list to the pool before anything subscribes. */}
          <StoredRelays />
          <ClockProvider>{children}</ClockProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  )
}
