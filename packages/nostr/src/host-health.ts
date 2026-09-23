/** Which media hosts are answering, learned as the page runs. */

/** Failures with no intervening success before a host is moved to the back. */
const DEMOTE_AFTER = 2

/** How long a demotion lasts without further failures. */
const DEMOTE_MS = 5 * 60_000

interface Record_ {
  failures: number
  /** When the most recent failure landed. */
  at: number
}

const health = new Map<string, Record_>()

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/** A host produced nothing. */
export function noteHostFailure(url: string): void {
  const host = hostOf(url)
  if (host === undefined) return
  const held = health.get(host)
  const fresh = held !== undefined && Date.now() - held.at < DEMOTE_MS
  health.set(host, { failures: (fresh ? held.failures : 0) + 1, at: Date.now() })
}

/** A host produced a picture, so whatever we thought about it is out of date. */
export function noteHostSuccess(url: string): void {
  const host = hostOf(url)
  if (host !== undefined) health.delete(host)
}

export function isDemoted(url: string): boolean {
  const host = hostOf(url)
  if (host === undefined) return false
  const held = health.get(host)
  if (held === undefined) return false
  if (Date.now() - held.at >= DEMOTE_MS) {
    health.delete(host)
    return false
  }
  return held.failures >= DEMOTE_AFTER
}

/** The same candidates, with known-bad hosts moved to the back. */
export function reorderByHealth(urls: readonly string[]): string[] {
  const ok: string[] = []
  const bad: string[] = []
  for (const url of urls) (isDemoted(url) ? bad : ok).push(url)
  return [...ok, ...bad]
}

/** Testing only: forget everything learned so far. */
export function resetHostHealth(): void {
  health.clear()
}
