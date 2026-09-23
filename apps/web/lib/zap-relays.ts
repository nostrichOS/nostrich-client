'use client'

import { ZAP_RELAYS, type RelayUrl } from '@nostrich/nostr'

import { getPool } from './pool'

/** The relays to ask for ZAP RECEIPTS: this reader's own, plus the few that carry. */
export function zapRelays(): RelayUrl[] {
  const mine = getPool().readRelays()
  const extra = ZAP_RELAYS.filter(url => !mine.includes(url))
  return extra.length === 0 ? mine : [...mine, ...extra]
}
