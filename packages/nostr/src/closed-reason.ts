/** Reading a relay's `CLOSED` frame: did the connection drop, or did the relay say. */

/** Refusals that will be repeated verbatim on the next identical request. */
const PERMANENT = new Set(['auth-required', 'restricted', 'blocked', 'invalid', 'unsupported', 'pow'])

/** The prefix of a `CLOSED` reason, or undefined when there is not one. */
export function closedReasonPrefix(reason: string): string | undefined {
  const at = reason.indexOf(':')
  if (at <= 0) return undefined
  // `wss://relay.example: connection lost` is a transport message whose first colon.
  if (reason.startsWith('//', at + 1)) return undefined
  const prefix = reason.slice(0, at).trim().toLowerCase()
  // A message like "wss://relay.example: connection lost" is not a NIP-01 prefix.
  return /^[a-z]+(?:-[a-z]+)*$/.test(prefix) ? prefix : undefined
}

/** Whether this subscription should stop being retried against this relay. */
export function isPermanentRefusal(reason: string): boolean {
  const prefix = closedReasonPrefix(reason)
  return prefix !== undefined && PERMANENT.has(prefix)
}
