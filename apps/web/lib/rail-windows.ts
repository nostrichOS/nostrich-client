'use client'

import { useCallback, useEffect, useState } from 'react'

/** The time window a rail panel is showing, remembered for this browser. */

/** The rail's window pickers. */
export const TRENDING_WINDOW_KEY = 'nostrich:rail-trending-window'
export const TOPICS_WINDOW_KEY = 'nostrich:rail-topics-window'

const listeners = new Set<() => void>()

function announce(): void {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  // Another tab of the same browser is the same reader looking at the same panel.
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === TRENDING_WINDOW_KEY || event.key === TOPICS_WINDOW_KEY) {
      announce()
    }
  })
}

function readWindow(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(key)
  } catch {
    // Storage denied.
    return null
  }
}

export function useWindowChoice(
  base: string,
  allowed: readonly number[],
  fallback: number,
): [number, (hours: number) => void] {
  const [hours, setHours] = useState(fallback)
  // Compared by VALUE: a fresh array literal from the caller would re-run the effect.
  const allowedKey = allowed.join(',')

  useEffect(() => {
    const read = (): void => {
      const stored = Number(readWindow(base))
      const permitted = allowedKey.split(',').map(Number)
      setHours(permitted.includes(stored) ? stored : fallback)
    }
    read()
    listeners.add(read)
    return () => {
      listeners.delete(read)
    }
  }, [base, allowedKey, fallback])

  const set = useCallback(
    (next: number): void => {
      // An unknown window would be stored and then silently ignored on the next read.
      if (!allowedKey.split(',').map(Number).includes(next)) return
      try {
        localStorage.setItem(base, String(next))
      } catch {
        // Private mode or a full quota.
      }
      setHours(next)
      announce()
    },
    [base, allowedKey],
  )

  return [hours, set]
}
