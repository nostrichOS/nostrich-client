'use client'

/** Reader-chosen text size, as a `data-font` attribute on <html>. */

import { onScopedChange, readScoped, SCOPED_READER_JS, writeScoped } from './scope'
import { FONT_KEY } from './settings-keys'

export { FONT_KEY as FONT_STORAGE_KEY } from './settings-keys'
const FONT_STORAGE_KEY = FONT_KEY

export const FONT_SIZES = [
  { id: 'sm', label: 'Small' },
  { id: 'md', label: 'Default' },
  { id: 'lg', label: 'Large' },
  { id: 'xl', label: 'Largest' },
] as const

export type FontSize = (typeof FONT_SIZES)[number]['id']

export const DEFAULT_FONT_SIZE: FontSize = 'md'

function isFontSize(value: unknown): value is FontSize {
  return FONT_SIZES.some(size => size.id === value)
}

/** Runs before the first paint, inlined at the top of <body>. */
export const FONT_BOOTSTRAP_SCRIPT = `(function(){try{var v=(${SCOPED_READER_JS})(${JSON.stringify(
  FONT_STORAGE_KEY,
)});if(v&&v!==${JSON.stringify(DEFAULT_FONT_SIZE)}&&/^(sm|lg|xl)$/.test(v)){document.documentElement.setAttribute('data-font',v)}}catch(e){}})()`

export function readStoredFontSize(): FontSize {
  // Private-mode Safari throws on localStorage access rather than returning null.
  if (typeof window === 'undefined') return DEFAULT_FONT_SIZE
  try {
    const stored = readScoped(FONT_STORAGE_KEY)
    return isFontSize(stored) ? stored : DEFAULT_FONT_SIZE
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

export function currentFontSize(): FontSize {
  if (typeof document === 'undefined') return DEFAULT_FONT_SIZE
  const value = document.documentElement.getAttribute('data-font')
  return isFontSize(value) ? value : DEFAULT_FONT_SIZE
}

export function applyFontSize(size: FontSize): void {
  paintFontSize(size)
  writeScoped(FONT_STORAGE_KEY, size)
}

/** The attribute half, without the write. */
function paintFontSize(size: FontSize): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // The default is the absence of the attribute, so a reader who never touches.
  if (size === DEFAULT_FONT_SIZE) root.removeAttribute('data-font')
  else root.setAttribute('data-font', size)
}

/** Another account, another tab, or another device: wear what THAT copy says. */
onScopedChange(base => {
  if (base !== undefined && base !== FONT_STORAGE_KEY) return
  const next = readStoredFontSize()
  if (next !== currentFontSize()) paintFontSize(next)
})
