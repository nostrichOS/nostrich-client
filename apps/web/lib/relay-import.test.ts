import { describe, expect, it } from 'vitest'

/** The guard that decides whether a published relay list may replace. */

/** Mirrors the two conditions in `useRelayPrefs` / `useImportedRelayList`. */
function mayImport(input: { hydrated: boolean; customised: boolean; cookieAtApply: string[] | null }): boolean {
  if (!input.hydrated) return false
  if (input.customised) return false
  return input.cookieAtApply === null
}

describe('relay list import guard', () => {
  it('imports for a reader who has never chosen relays here', () => {
    expect(mayImport({ hydrated: true, customised: false, cookieAtApply: null })).toBe(true)
  })

  it('never imports before the cookie has been read', () => {
    // The bug: at this moment `customised` is false only because nothing has looked yet.
    expect(mayImport({ hydrated: false, customised: false, cookieAtApply: ['wss://mine'] })).toBe(false)
  })

  it('never replaces a list the reader customised on this device', () => {
    expect(mayImport({ hydrated: true, customised: true, cookieAtApply: ['wss://mine'] })).toBe(false)
  })

  it('never applies on top of a list that appeared while the fetch was in flight', () => {
    // A reader can add a relay during the second or two the query takes.
    expect(mayImport({ hydrated: true, customised: false, cookieAtApply: ['wss://added-just-now'] })).toBe(false)
  })
})
