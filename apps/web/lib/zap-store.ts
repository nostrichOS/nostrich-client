'use client'

import { useEffect, useSyncExternalStore } from 'react'

import type { ZapDetail } from './interactions'

/** One note's zaps, pooled from every surface that has ever asked, and never shrinking. */

/** Notes held. */
const MAX_NOTES = 400

/** Zaps kept per note. */
const MAX_PER_NOTE = 60

const STORE_KEY = 'zaps:v1'

const held = new Map<string, ZapDetail[]>()

/** Notes whose zaps some surface has finished fetching. */
const settled = new Set<string>()
const listeners = new Set<() => void>()
let version = 0
let loaded = false
let writeTimer: ReturnType<typeof setTimeout> | undefined

function identity(zap: ZapDetail): string {
  return `${zap.sender}:${zap.sats}:${zap.at}`
}

function load(): void {
  loaded = true
}

/** Batched, because a feed settling writes this once per note per frame otherwise. */
function scheduleWrite(): void {
  if (writeTimer !== undefined) return
  writeTimer = setTimeout(() => {
    writeTimer = undefined
  }, 1_500)
}

/** Add what this surface found. */
export function rememberZaps(id: string, found: readonly ZapDetail[]): void {
  if (id === '' || found.length === 0) return
  load()
  let current = held.get(id) ?? []
  const seen = new Set(current.map(identity))
  let added = false
  for (const zap of found) {
    const key = identity(zap)
    if (seen.has(key)) continue
    seen.add(key)
    current.push(zap)
    added = true
  }
  if (!added) return

  /* A real receipt retires the optimistic entry it corresponds. */
  const settled = new Set(
    current.filter(zap => zap.pending !== true).map(zap => `${zap.sender}:${zap.sats}`),
  )
  if (settled.size > 0) {
    current = current.filter(zap => zap.pending !== true || !settled.has(`${zap.sender}:${zap.sats}`))
  }

  // Newest first, which is what the row of faces reads.
  current.sort((a, b) => b.at - a.at)
  if (current.length > MAX_PER_NOTE) current.length = MAX_PER_NOTE
  // Re-inserted so it moves to the back of the eviction order on every sighting.
  held.delete(id)
  held.set(id, current)
  while (held.size > MAX_NOTES) {
    const oldest = held.keys().next().value
    if (oldest === undefined) break
    held.delete(oldest)
  }
  version += 1
  scheduleWrite()
  for (const listener of listeners) listener()
}

/** Called when a fetch covering these notes has finished. */
export function markZapsSettled(ids: Iterable<string>): void {
  let changed = false
  for (const id of ids) {
    if (id === '' || settled.has(id)) continue
    settled.add(id)
    changed = true
  }
  if (!changed) return
  version += 1
  for (const listener of listeners) listener()
}

export function zapsSettled(id: string | undefined): boolean {
  return id !== undefined && settled.has(id)
}

/** Show a zap before it has been paid, and take it back. */
export function addPendingZap(id: string, zap: Omit<ZapDetail, 'pending'>): ZapDetail {
  const entry: ZapDetail = { ...zap, pending: true }
  rememberZaps(id, [entry])
  return entry
}

/** The payment finished. */
export function settlePendingZap(id: string, entry: ZapDetail, ok: boolean): void {
  if (ok) return
  const list = held.get(id)
  if (list === undefined) return
  const key = identity(entry)
  const kept = list.filter(zap => !(zap.pending === true && identity(zap) === key))
  if (kept.length === list.length) return
  if (kept.length === 0) held.delete(id)
  else held.set(id, kept)
  version += 1
  scheduleWrite()
  for (const listener of listeners) listener()
}

export function zapsFor(id: string | undefined): readonly ZapDetail[] | undefined {
  if (id === undefined || id === '') return undefined
  load()
  return held.get(id)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): number {
  return version
}

function serverSnapshot(): number {
  return 0
}

/** The zaps to render for this note: everything anybody has found, including. */
export function useZaps(id: string | undefined, found?: readonly ZapDetail[]): readonly ZapDetail[] {
  useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  // Keyed on the CONTENTS, not the array: a feed hands a fresh array down.
  const signature =
    found === undefined ? '' : found.map(zap => `${zap.sender}:${zap.sats}:${zap.at}`).join('|')
  useEffect(() => {
    // Written in an effect, never during render: this notifies every other strip.
    if (id !== undefined && signature !== '' && found !== undefined) rememberZaps(id, found)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `found` is derived from `signature`
  }, [id, signature])
  return zapsFor(id) ?? found ?? []
}

/** Forgets everything. For tests. */
export function forgetZaps(): void {
  held.clear()
  settled.clear()
  loaded = false
  version += 1
}
