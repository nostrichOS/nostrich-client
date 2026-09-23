'use client'

import type { NostrEvent } from '@nostrich/nostr'

/** Notes this reader just published, announced to whatever feeds are mounted. */

type Listener = (event: NostrEvent) => void

const listeners = new Set<Listener>()

/** Called by a composer the moment it has a signed event, before the relays. */
export function announcePublished(event: NostrEvent): void {
  for (const listener of listeners) listener(event)
}

/** The note did not go out after all: take it back off whatever showed. */
const retractors = new Set<(id: string) => void>()

export function announceRetracted(id: string): void {
  for (const listener of retractors) listener(id)
}

export function onRetracted(listener: (id: string) => void): () => void {
  retractors.add(listener)
  return () => retractors.delete(listener)
}

/** Called by a feed while it is mounted. */
export function onPublished(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
