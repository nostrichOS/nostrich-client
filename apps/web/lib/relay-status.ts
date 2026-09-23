'use client'

import { useEffect, useState } from 'react'
import type { RelayStatus } from '@nostrich/nostr'

import { getPool } from './pool'

const POLL_MS = 2_000

/** Relay state, polled rather than pushed. */
export function useRelayStatus(): RelayStatus[] {
  const [statuses, setStatuses] = useState<RelayStatus[]>([])

  useEffect(() => {
    const read = (): void => setStatuses(getPool().status())
    read()
    const interval = setInterval(read, POLL_MS)
    return () => clearInterval(interval)
  }, [])

  return statuses
}

export interface RelayTally {
  open: number
  connecting: number
  down: number
  total: number
}

export function tallyRelays(statuses: readonly RelayStatus[]): RelayTally {
  let open = 0
  let connecting = 0
  let down = 0
  for (const status of statuses) {
    if (status.state === 'open') open += 1
    else if (status.state === 'connecting') connecting += 1
    else down += 1
  }
  return { open, connecting, down, total: statuses.length }
}
