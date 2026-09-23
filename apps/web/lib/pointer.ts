'use client'

/** IS THIS DEVICE DRIVEN BY A FINGER. */
export function touchPrimary(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: none), (pointer: coarse)').matches
}
