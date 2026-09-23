'use client'

import { useEffect, useRef } from 'react'
import { isCiphertext, nowSeconds, type Hex, type NostrEvent, type Signer } from '@nostrich/nostr'

import { getPool } from './pool'
import { adoptChatMarkers, chatMarkers, onChatMarkersChange } from './chat'
import { adoptSeenMarkers, onSeenMarkersChange, seenMarkers, type SeenMarkers } from './notifications'

/** Carrying "I have read this" between devices. */

/** NIP-78 application data. */
const APP_DATA_KIND = 30078
/** Our slot. */
const IDENTIFIER = 'nostrich/seen'

const QUERY_TIMEOUT_MS = 6_000

/** How many conversation markers travel. */
const CHAT_MARKER_CAP = 200
/** A minute. */
const PUBLISH_DEBOUNCE_MS = 60_000

/** The stored shape. */
export interface SeenPayload extends Partial<SeenMarkers> {
  [key: string]: unknown
}

/** Every marker, taking the later of the two. */
export function mergeSeen(local: SeenMarkers, remote: SeenPayload): SeenMarkers {
  return {
    notifications: Math.max(local.notifications, number(remote['notifications'])),
    zaps: Math.max(local.zaps, number(remote['zaps'])),
  }
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** The JSON that gets encrypted. */
export function buildSeenPayload(
  markers: SeenMarkers,
  previous: SeenPayload,
  chat?: Readonly<Record<string, number>>,
): string {
  return JSON.stringify({
    ...previous,
    notifications: markers.notifications,
    zaps: markers.zaps,
    ...(chat === undefined ? {} : { chat }),
  })
}

/** The chat half of a stored payload, validated. */
export function chatFromPayload(payload: SeenPayload): Record<string, number> {
  const raw = payload['chat']
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value
  }
  return out
}

/** The newest `CHAT_MARKER_CAP` markers, which is what gets published. */
export function cappedChat(all: Readonly<Record<string, number>>): Record<string, number> {
  const entries = Object.entries(all)
  if (entries.length <= CHAT_MARKER_CAP) return { ...all }
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, CHAT_MARKER_CAP))
}

export function parseSeenPayload(plaintext: string): SeenPayload {
  try {
    const parsed: unknown = JSON.parse(plaintext)
    // An array is valid JSON and not a payload.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as SeenPayload
  } catch {
    // Somebody else's data in our slot, or a half-written event.
    return {}
  }
}

/** Keeps this device's read markers and the published ones in step. */
export function useSeenSync(signer: Signer | undefined, pubkey: Hex | undefined): void {
  /** What the stored event held, so unknown fields survive the next publish. */
  const stored = useRef<SeenPayload>({})
  /** Suppresses the publish that hydration itself would otherwise trigger. */
  const settling = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** The values last published, so an unchanged marker never republishes. */
  const published = useRef<SeenMarkers | undefined>(undefined)
  /** Serialised, because the chat half is a map and comparing it field by field. */
  const publishedChat = useRef<string | undefined>(undefined)

  useEffect(() => {
    stored.current = {}
    settling.current = true
    published.current = undefined
    publishedChat.current = undefined
    if (signer === undefined || pubkey === undefined) return

    let cancelled = false

    const publish = async (): Promise<void> => {
      if (cancelled || signer === undefined || pubkey === undefined) return
      const markers = seenMarkers()
      const chat = cappedChat(chatMarkers())
      const chatSignature = JSON.stringify(chat)
      if (
        published.current !== undefined &&
        published.current.notifications === markers.notifications &&
        published.current.zaps === markers.zaps &&
        publishedChat.current === chatSignature
      ) {
        return
      }
      let content: string
      try {
        content = await signer.nip44Encrypt(pubkey, buildSeenPayload(markers, stored.current, chat))
        // A signer that answers the call without actually encrypting would publish.
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
        published.current = markers
        publishedChat.current = chatSignature
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
          const payload = parseSeenPayload(await signer.nip44Decrypt(pubkey, newest.content))
          if (cancelled) return
          stored.current = payload
          // The half that makes reading on a desktop reach the phone.
          adoptSeenMarkers(mergeSeen(seenMarkers(), payload))
          // The half that stops a conversation read on a laptop being bold again on a phone.
          adoptChatMarkers(chatFromPayload(payload))
        }
      } catch {
        // Nothing published yet, unreachable relays, or a payload we cannot read.
      } finally {
        if (!cancelled) {
          settling.current = false
          // What this device already knew may be ahead of what was stored.
          void publish()
        }
      }
    })()

    const schedule = (): void => {
      if (settling.current) return
      if (timer.current !== undefined) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = undefined
        void publish()
      }, PUBLISH_DEBOUNCE_MS)
    }

    const stop = onSeenMarkersChange(schedule)
    // Opening a conversation moves a marker without touching the notification ones.
    const stopChat = onChatMarkersChange(schedule)

    return () => {
      cancelled = true
      stop()
      stopChat()
      if (timer.current !== undefined) {
        clearTimeout(timer.current)
        timer.current = undefined
      }
    }
  }, [signer, pubkey])
}

/** Relays disagree about which replaceable event is current. */
function newestOf(events: readonly NostrEvent[]): NostrEvent | undefined {
  let newest: NostrEvent | undefined
  for (const event of events) {
    if (newest === undefined || event.created_at > newest.created_at) newest = event
  }
  return newest
}
