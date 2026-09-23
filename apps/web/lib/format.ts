import { encodeNpub, shortNpub, type Hex } from '@nostrich/nostr'

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Compact age, the way a timeline reads it: 12s, 4m, 3h, 6d, then a date. */
export function relativeTime(seconds: number, nowSeconds: number): string {
  const delta = Math.max(0, nowSeconds - seconds)
  if (delta < MINUTE) return `${Math.floor(delta)}s`
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`
  return absoluteDate(seconds)
}

/** The same clock, but it never gives up and prints a date. */
export function relativeTimeShort(seconds: number, nowSeconds: number): string {
  const delta = Math.max(0, nowSeconds - seconds)
  if (delta < MINUTE) return `${Math.floor(delta)}s`
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`
  if (delta < 30 * DAY) return `${Math.floor(delta / (7 * DAY))}w`
  return `${Math.floor(delta / (30 * DAY))}mo`
}

export function absoluteDate(seconds: number): string {
  const date = new Date(seconds * 1000)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** `August 2026`. */
export function joinedMonth(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function absoluteTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString()
}

/** `npub1abc…xyz9`. Falls back to a truncated hex if the key will not encode. */
export function displayKey(pubkey: Hex): string {
  return shortNpub(pubkey)
}

export function npubOf(pubkey: Hex): string {
  try {
    return encodeNpub(pubkey)
  } catch {
    return pubkey
  }
}

/** 1200 → 1.2k. */
export function compactCount(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  /* The billions rung exists for /stats, not for the feed. */
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}b`
}

/** 274,429 → `274k`, and never `275k`. */
export function floorCount(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 10_000) return `${Math.floor(n / 100) / 10}k`
  if (n < 1_000_000) return `${Math.floor(n / 1_000)}k`
  return `${Math.floor(n / 100_000) / 10}m`
}

export function pluralize(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
