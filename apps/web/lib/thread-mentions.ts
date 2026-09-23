'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { onScopedChange, readScoped, scopedRecord, writeScoped } from './scope'
import { THREAD_MENTIONS_KEY as KEY } from './settings-keys'

/** Whether replies in a thread you were merely TAGGED in count as mentions. */
/** ON, matching the request that introduced. */
const DEFAULT_ON = true

let enabled: boolean | undefined
const listeners = new Set<() => void>()
let version = 0

function read(): boolean {
  if (enabled !== undefined) return enabled
  if (typeof window === 'undefined') return DEFAULT_ON
  const stored = readScoped(KEY)
  enabled = stored === null ? DEFAULT_ON : stored === '1'
  return enabled
}

/** A theme, a grouping choice and this all belong to an ACCOUNT, not to a browser. */
onScopedChange(base => {
  if (base !== undefined && base !== KEY) return
  enabled = undefined
  version += 1
  for (const listener of listeners) listener()
})

export function useThreadMentions(): [boolean, (next: boolean) => void] {
  useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
    () => 0,
  )

  const set = useCallback((next: boolean) => {
    enabled = next
    writeScoped(KEY, next ? '1' : '0')
    version += 1
    for (const listener of listeners) listener()
  }, [])

  return [typeof window === 'undefined' ? DEFAULT_ON : read(), set]
}

/** The value alone, subscribed. */
export function useThreadMentionsValue(): boolean {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => (typeof window === 'undefined' ? DEFAULT_ON : read()),
    () => DEFAULT_ON,
  )
}

/** The same answer for code that is not a component. */
export function threadMentionsEnabled(): boolean {
  return typeof window === 'undefined' ? DEFAULT_ON : read()
}

/** The same answer for an account that is NOT in front. */
export function threadMentionsEnabledFor(pubkey: string): boolean {
  if (typeof window === 'undefined') return DEFAULT_ON
  const stored = scopedRecord(KEY, pubkey)?.v
  return typeof stored === 'string' ? stored === '1' : DEFAULT_ON
}
