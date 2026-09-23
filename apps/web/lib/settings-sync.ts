'use client'

import { useEffect, useRef } from 'react'
import { isCiphertext, nowSeconds, type Hex, type NostrEvent, type Signer } from '@nostrich/nostr'

import { getPool } from './pool'
import { applyScoped, onScopedChange, scopedRecord } from './scope'
import { SYNCED_BASES, SYNCED_SETTINGS } from './settings-keys'

/** Carrying SETTINGS between devices. */

/** NIP-78 application data. */
const APP_DATA_KIND = 30078
/** Our slot. */
const IDENTIFIER = 'nostrich/settings'

const QUERY_TIMEOUT_MS = 6_000

/** Three seconds. */
const PUBLISH_DEBOUNCE_MS = 3_000

/** `{ v, at }` per setting id, plus whatever a newer build stored that this one does. */
export interface SettingsPayload {
  [id: string]: unknown
}

interface Entry {
  v: string
  at: number
}

function entryOf(value: unknown): Entry | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const held = value as { v?: unknown; at?: unknown }
  if (typeof held.v !== 'string') return undefined
  return { v: held.v, at: typeof held.at === 'number' && Number.isFinite(held.at) ? held.at : 0 }
}

export function parseSettingsPayload(plaintext: string): SettingsPayload {
  try {
    const parsed: unknown = JSON.parse(plaintext)
    // An array is valid JSON and not a payload.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as SettingsPayload
  } catch {
    // Somebody else's data in our slot, or a half-written event.
    return {}
  }
}

/** Everything this device holds, over whatever the stored copy. */
export function buildSettingsPayload(previous: SettingsPayload): SettingsPayload {
  const out: SettingsPayload = { ...previous }
  for (const setting of SYNCED_SETTINGS) {
    const held = scopedRecord(setting.base)
    if (held === undefined) continue
    const remote = entryOf(previous[setting.id])
    // Never publish an older value over a newer one.
    if (remote !== undefined && remote.at > held.at) continue
    out[setting.id] = { v: held.v, at: held.at }
  }
  return out
}

/** Take everything the payload knows more recently than we do. */
export function adoptSettings(payload: SettingsPayload): string[] {
  const applied: string[] = []
  for (const setting of SYNCED_SETTINGS) {
    const remote = entryOf(payload[setting.id])
    if (remote === undefined) continue
    const held = scopedRecord(setting.base)
    // Strictly newer.
    if (held !== undefined && held.at >= remote.at) continue
    if (held !== undefined && held.v === remote.v) continue
    applyScoped(setting.base, remote.v, remote.at)
    applied.push(setting.id)
  }
  return applied
}

/** Relays disagree about which replaceable event is current. */
function newestOf(events: readonly NostrEvent[]): NostrEvent | undefined {
  let newest: NostrEvent | undefined
  for (const event of events) {
    if (newest === undefined || event.created_at > newest.created_at) newest = event
  }
  return newest
}

/** Keeps this device's settings and the published ones in step. */
export function useSettingsSync(signer: Signer | undefined, pubkey: Hex | undefined): void {
  /** What the stored event held, so a newer build's fields survive our next publish. */
  const stored = useRef<SettingsPayload>({})
  /** Suppresses the publish that adopting the remote copy would otherwise trigger. */
  const settling = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** The exact JSON last published, so an unchanged set never republishes. */
  const published = useRef<string | undefined>(undefined)

  useEffect(() => {
    stored.current = {}
    settling.current = true
    published.current = undefined
    if (signer === undefined || pubkey === undefined) return

    let cancelled = false

    const publish = async (): Promise<void> => {
      if (cancelled) return
      const payload = buildSettingsPayload(stored.current)
      const json = JSON.stringify(payload)
      if (json === published.current) return

      let content: string
      try {
        content = await signer.nip44Encrypt(pubkey, json)
        // A signer that answers without actually encrypting would publish the reader's.
        if (!isCiphertext(content)) return
      } catch {
        // Cannot encrypt, so nothing is published.
        return
      }
      if (cancelled) return
      try {
        const event = await signer.signEvent({
          kind: APP_DATA_KIND,
          created_at: nowSeconds(),
          tags: [['d', IDENTIFIER]],
          content,
        })
        await getPool().publish(event)
        stored.current = payload
        published.current = json
      } catch {
        // Offline, or every relay refused.
      }
    }

    void (async () => {
      try {
        const events = await getPool().query(
          [{ kinds: [APP_DATA_KIND], authors: [pubkey], '#d': [IDENTIFIER], limit: 1 }],
          undefined,
          QUERY_TIMEOUT_MS,
        )
        if (cancelled) return
        const newest = newestOf(events)
        if (newest !== undefined && newest.content.trim() !== '') {
          const payload = parseSettingsPayload(await signer.nip44Decrypt(pubkey, newest.content))
          if (cancelled) return
          stored.current = payload
          // The half that makes a choice made at a desk reach the phone.
          adoptSettings(payload)
        }
      } catch {
        // Nothing published yet, unreachable relays, or a payload we cannot read.
      } finally {
        if (!cancelled) {
          settling.current = false
          // This device may be ahead of what was stored.
          void publish()
        }
      }
    })()

    const stop = onScopedChange(base => {
      // An account switch (`base` undefined) is not a change to publish: it means this hook.
      if (base === undefined || !SYNCED_BASES.has(base)) return
      if (settling.current) return
      if (timer.current !== undefined) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = undefined
        void publish()
      }, PUBLISH_DEBOUNCE_MS)
    })

    return () => {
      cancelled = true
      stop()
      if (timer.current !== undefined) {
        clearTimeout(timer.current)
        timer.current = undefined
      }
    }
  }, [signer, pubkey])
}
