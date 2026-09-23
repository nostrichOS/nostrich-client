'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** One timer for every relative timestamp on the page. */
const ClockContext = createContext(0)

const TICK_MS = 30_000

export function ClockProvider({ children }: { children: ReactNode }): ReactNode {
  const [now, setNow] = useState(0)

  useEffect(() => {
    const tick = (): void => setNow(Math.floor(Date.now() / 1000))
    tick()
    const interval = setInterval(tick, TICK_MS)
    return () => clearInterval(interval)
  }, [])

  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>
}

export function useNowSeconds(): number {
  return useContext(ClockContext)
}
