'use client'

import { splitScopedKey, storageKeysFor } from './scope'

/** Everything this app keeps on the reader's device, and how to get rid. */

export type DataKind = 'cache' | 'preference' | 'private' | 'identity'

export interface StoredItem {
  key: string
  label: string
  kind: DataKind
  /** What is lost by clearing it, in the reader's terms rather than the code's. */
  cost: string
}

export const STORED_ITEMS: StoredItem[] = [
  // --- caches: derivable from the network, so clearing costs only time ---.
  {
    key: 'nostrich:profiles:v1',
    label: 'Names and avatars',
    kind: 'cache',
    cost: 'The next load shows npubs until profiles arrive again.',
  },
  {
    key: 'nostrich:nip05:v1',
    label: 'Verification results',
    kind: 'cache',
    cost: 'Verified badges re-check themselves once.',
  },
  {
    key: 'nostrich:feed:v1',
    label: 'Last timeline snapshot',
    kind: 'cache',
    cost: 'The next open shows a loading skeleton.',
  },
  {
    key: 'nostrich:tagspam:v1',
    label: 'Known tag-spam accounts',
    kind: 'cache',
    cost: 'They are re-detected the next time they post.',
  },

  // --- preferences: cheap to lose, annoying to lose silently ---.
  {
    key: 'nostrich:chat-deleted',
    label: 'Deleted conversations',
    kind: 'preference',
    cost: 'Conversations you removed from Chat come back.',
  },
  {
    key: 'nostrich:chat-accepted',
    label: 'Accepted message requests',
    kind: 'preference',
    cost: 'Accepted requests return to the Requests tab.',
  },
  { key: 'nostrich:badge', label: 'Verified badge colour', kind: 'preference', cost: 'Back to blue.' },
  { key: 'nostrich.fontSize', label: 'Text size', kind: 'preference', cost: 'Back to default.' },
  { key: 'nostrich:news-language', label: 'News language', kind: 'preference', cost: 'Back to English.' },
  { key: 'nostrich:zap-amount', label: 'Default zap amount', kind: 'preference', cost: 'Back to 21 sats.' },
  {
    key: 'nostrich:feeds',
    label: 'Custom feeds',
    kind: 'preference',
    cost: 'Every feed you built is gone. They live only on this device.',
  },
  {
    key: 'nostrich:custom-feed',
    label: 'Custom feeds (legacy)',
    kind: 'preference',
    cost: 'The pre-rename copy of the same thing.',
  },
  {
    key: 'nostrich:muted',
    label: 'Muted accounts',
    kind: 'preference',
    cost: 'Everyone you muted comes back. Not published, so it cannot be recovered.',
  },
  {
    key: 'nostrich:muted-reposts',
    label: 'Repost-muted accounts',
    kind: 'preference',
    cost: 'Their reposts return to your timeline.',
  },
  {
    key: 'nostrich:deleted:v1',
    label: 'Locally hidden notes',
    kind: 'preference',
    cost: 'Notes you asked to delete reappear if any relay still serves them.',
  },
  {
    key: 'nostrich:drafts',
    label: 'Saved drafts',
    kind: 'preference',
    cost: 'Unposted drafts are gone for good.',
  },
  {
    key: 'nostrich:notifications-seen',
    label: 'Notifications read marker',
    kind: 'preference',
    cost: 'Everything looks unread once.',
  },
  { key: 'nostrich:chat-read', label: 'Chat read markers', kind: 'preference', cost: 'Conversations look unread once.' },

  // --- private: not identity, but it spends money or reveals something ---.
  {
    key: 'nostrich:wallet:v1',
    label: 'Wallet connection',
    kind: 'private',
    cost: 'Disconnects your lightning wallet. Zapping stops until you reconnect it.',
  },

  // --- identity: the account itself ---.
  {
    key: 'nostrich.accounts',
    label: 'Signed-in accounts',
    kind: 'identity',
    cost: 'Signs you out. Any account whose nsec is not written down elsewhere is UNRECOVERABLE.',
  },
  {
    key: 'nostrich.session',
    label: 'Session (legacy)',
    kind: 'identity',
    cost: 'The older single-account record of the same thing.',
  },
]

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** What this item actually occupies, across every account on this device. */
function measure(base: string): { present: boolean; bytes: number } {
  const keys = storageKeysFor(base)
  if (keys.length === 0) return { present: false, bytes: 0 }
  return {
    present: true,
    bytes: keys.reduce((sum, key) => sum + (read(key)?.length ?? 0), 0),
  }
}

export interface StoredReport extends StoredItem {
  present: boolean
  /** Rough size in bytes, so a reader can see what is actually taking up room. */
  bytes: number
}

export function inspectStorage(): StoredReport[] {
  if (typeof window === 'undefined') return []
  return STORED_ITEMS.map(item => ({ ...item, ...measure(item.key) }))
}

/** Keys this app wrote that the inventory above does not name. */
export function unknownKeys(): string[] {
  if (typeof window === 'undefined') return []
  const known = new Set(STORED_ITEMS.map(item => item.key))
  const out: string[] = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key === null || !key.startsWith('nostrich')) continue
      if (known.has(key)) continue
      const base = splitScopedKey(key)?.base
      if (base !== undefined && known.has(base)) continue
      out.push(key)
    }
  } catch {
    // Storage unavailable.
  }
  return out
}

export function clearKeys(keys: readonly string[]): void {
  for (const key of keys) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Nothing to do.
    }
  }
}

export function clearByKind(kinds: readonly DataKind[]): void {
  // Expanded to the keys that exist, for the same reason `measure` is: removing a bare.
  clearKeys(
    STORED_ITEMS.filter(item => kinds.includes(item.kind)).flatMap(item => storageKeysFor(item.key)),
  )
}

/** Developer mode. */
const DEV_KEY = 'nostrich:dev-mode'

export function isDevMode(): boolean {
  try {
    return localStorage.getItem(DEV_KEY) === '1'
  } catch {
    return false
  }
}

export function setDevMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEV_KEY, '1')
    else localStorage.removeItem(DEV_KEY)
  } catch {
    // Private mode.
  }
}
