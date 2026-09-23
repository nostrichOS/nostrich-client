import type { RelayEntry } from '@nostrich/nostr'

import type { RelayPolicyChoice } from './relay-cookie'

/** The kind-10002 to publish, built from the reader's list WITHOUT destroying. */
export function mergeRelayList(
  /** What the reader's Relays tab currently shows, in their order. */
  chosen: readonly string[],
  /** Their kind-10002 as it stands on the network, or empty when they have never. */
  published: readonly RelayEntry[],
  /** What the reader chose HERE, per relay. */
  chosenPolicies: Readonly<Record<string, RelayPolicyChoice>> = {},
): RelayEntry[] {
  const byUrl = new Map(published.map(entry => [entry.url as string, entry]))
  const wanted = new Set(chosen)

  const out: RelayEntry[] = []
  for (const url of chosen) {
    const choice = chosenPolicies[url]
    if (choice !== undefined) {
      // An explicit decision on this screen.
      out.push({
        url,
        policy: { read: choice !== 'write', write: choice !== 'read' },
      } as RelayEntry)
      continue
    }
    const held = byUrl.get(url)
    out.push(
      held === undefined
        ? // New here, and read + write is the default for anything added on this screen.
          ({ url, policy: { read: true, write: true } } as RelayEntry)
        : // No decision here, so their published markers stand untouched.
          ({ url: held.url, policy: { ...held.policy } } as RelayEntry),
    )
  }

  for (const entry of published) {
    if (wanted.has(entry.url as string)) continue
    // Readable and absent means they removed.
    if (entry.policy.read) continue
    out.push(entry)
  }

  return out
}
