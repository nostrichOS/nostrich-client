import { THEME_STORAGE_KEY } from '@nostrich/ui'
import type { ThemeName } from '@nostrich/ui'

export type Theme = ThemeName
export { THEME_STORAGE_KEY }

/** ONE PALETTE, and it is light. */
export function currentTheme(): Theme {
  return 'light'
}

/** The address bar, status bar and installed-app title bar. */
export function paintThemeColor(): void {
  if (typeof document === 'undefined') return
  const colour = getComputedStyle(document.documentElement).getPropertyValue('--role-bg').trim()
  if (colour === '') return
  let meta = document.querySelector('meta[name="theme-color"]')
  if (meta === null) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', colour)
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
