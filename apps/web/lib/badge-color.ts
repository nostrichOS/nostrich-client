'use client'

import { useSyncExternalStore } from 'react'

/** The colour of the verified tick, chosen by the reader. */

import { onScopedChange, readScoped, SCOPED_READER_JS, writeScoped } from './scope'
import { BADGE_KEY as KEY } from './settings-keys'

/** Twitter's tick blue. The default because it is what the mark means to most people. */
export const DEFAULT_BADGE = '#1d9bf0'
export const DEFAULT_BADGE_B = '#a855f7'

export interface BadgeStyle {
  mode: 'solid' | 'gradient'
  /** Solid colour, or the first stop of the gradient. */
  color: string
  /** Second stop. */
  colorB: string
}

export const BADGE_PRESETS: { id: string; label: string; color: string }[] = [
  { id: 'blue', label: 'Blue', color: DEFAULT_BADGE },
  { id: 'purple', label: 'Purple', color: '#6558a7' },
  /** Bitcoin orange. */
  { id: 'orange', label: 'Orange', color: '#f7931a' },
  { id: 'gold', label: 'Gold', color: '#d99a2b' },
  { id: 'green', label: 'Green', color: '#1d9b73' },
  { id: 'rose', label: 'Rose', color: '#e0245e' },
  { id: 'graphite', label: 'Graphite', color: '#4b4655' },
]

export const DEFAULT_STYLE: BadgeStyle = {
  mode: 'solid',
  color: DEFAULT_BADGE,
  colorB: DEFAULT_BADGE_B,
}

/** Anything that reaches a `fill` attribute has to be a colour and nothing else. */
const HEX = /^#[0-9a-f]{6}$/i

function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value : fallback
}

export function readBadgeStyle(): BadgeStyle {
  if (typeof window === 'undefined') return DEFAULT_STYLE
  try {
    const raw = readScoped(KEY)
    if (raw === null) return DEFAULT_STYLE
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_STYLE
    const record = parsed as Record<string, unknown>
    return {
      mode: record.mode === 'gradient' ? 'gradient' : 'solid',
      color: safeColor(record.color, DEFAULT_BADGE),
      colorB: safeColor(record.colorB, DEFAULT_BADGE_B),
    }
  } catch {
    return DEFAULT_STYLE
  }
}

const listeners = new Set<() => void>()
let current: BadgeStyle = DEFAULT_STYLE
let loaded = false

function snapshot(): BadgeStyle {
  if (!loaded && typeof window !== 'undefined') {
    current = readBadgeStyle()
    loaded = true
  }
  return current
}

/** The server has no storage and must render the default, or hydration disagrees. */
function serverSnapshot(): BadgeStyle {
  return DEFAULT_STYLE
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function applyBadgeStyle(style: BadgeStyle): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--badge-a', style.color)
  // Solid mode points both stops at the same colour, so the gradient markup.
  root.style.setProperty('--badge-b', style.mode === 'gradient' ? style.colorB : style.color)
}

export function setBadgeStyle(style: BadgeStyle): void {
  current = {
    mode: style.mode,
    color: safeColor(style.color, DEFAULT_BADGE),
    colorB: safeColor(style.colorB, DEFAULT_BADGE_B),
  }
  loaded = true
  applyBadgeStyle(current)
  writeScoped(KEY, JSON.stringify(current))
  for (const listener of listeners) listener()
}

/** The badge is the account's own mark, so a switch repaints it from that account's. */
onScopedChange(base => {
  if (base !== undefined && base !== KEY) return
  current = readBadgeStyle()
  loaded = true
  applyBadgeStyle(current)
  for (const listener of listeners) listener()
})

export function useBadgeStyle(): BadgeStyle {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}

/** Runs before first paint, from the document head. */
export const BADGE_BOOTSTRAP_SCRIPT = `(function(){try{var s=(${SCOPED_READER_JS})(${JSON.stringify(
  KEY,
)});if(!s)return;var v=JSON.parse(s);var re=/^#[0-9a-f]{6}$/i;var a=re.test(v.color)?v.color:${JSON.stringify(
  DEFAULT_BADGE,
)};var b=v.mode==='gradient'&&re.test(v.colorB)?v.colorB:a;var r=document.documentElement;r.style.setProperty('--badge-a',a);r.style.setProperty('--badge-b',b)}catch(e){}})()`
