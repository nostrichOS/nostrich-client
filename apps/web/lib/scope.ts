/* NO `'use client'`, deliberately. */

/** Preferences belong to an ACCOUNT, not to a browser. */

const ACCOUNTS_KEY = 'nostrich.accounts'

/** A reader with no key at all still has preferences. */
export const ANON_SCOPE = 'anon'

const SEP = '::'

/** `{ v, at }`. */
interface Record_ {
  v: string
  at: number
}

/** Which account's settings are in force. */
export function resolveScope(): string {
  if (typeof window === 'undefined') return ANON_SCOPE
  let raw: string | null
  try {
    raw = localStorage.getItem(ACCOUNTS_KEY)
  } catch {
    return ANON_SCOPE
  }
  if (raw === null) return ANON_SCOPE
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return ANON_SCOPE
    const store = parsed as { accounts?: unknown; active?: unknown }
    const accounts = Array.isArray(store.accounts) ? store.accounts : []
    const keys = accounts
      .map(entry =>
        typeof entry === 'object' && entry !== null && typeof (entry as { pubkey?: unknown }).pubkey === 'string'
          ? ((entry as { pubkey: string }).pubkey)
          : undefined,
      )
      .filter((key): key is string => key !== undefined)
    if (keys.length === 0) return ANON_SCOPE
    if (typeof store.active !== 'string') return keys[0] ?? ANON_SCOPE
    return keys.includes(store.active) ? store.active : ANON_SCOPE
  } catch {
    return ANON_SCOPE
  }
}

let scope: string | undefined

export function activeScope(): string {
  if (scope === undefined) scope = resolveScope()
  return scope
}

/** Called by SessionProvider when the account in front changes. */
export function setActiveScope(pubkey: string | undefined): void {
  const next = pubkey ?? ANON_SCOPE
  if (next === scope) return
  scope = next
  notify(undefined)
}

function keyFor(base: string, forScope = activeScope()): string {
  return `${base}${SEP}${forScope}`
}

/** How many accounts this device holds. */
export function accountsHere(): number {
  return accountCount()
}

function accountCount(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (raw === null) return 0
    const parsed: unknown = JSON.parse(raw)
    const accounts = (parsed as { accounts?: unknown }).accounts
    return Array.isArray(accounts) ? accounts.length : 0
  } catch {
    return 0
  }
}

function parse(raw: string | null): Record_ | undefined {
  if (raw === null) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const held = parsed as { v?: unknown; at?: unknown }
    if (typeof held.v !== 'string') return undefined
    return { v: held.v, at: typeof held.at === 'number' && Number.isFinite(held.at) ? held.at : 0 }
  } catch {
    return undefined
  }
}

/** The value as it stands, or null. */
export function readScoped(base: string): string | null {
  if (typeof window === 'undefined') return null
  let held: Record_ | undefined
  try {
    held = parse(localStorage.getItem(keyFor(base)))
  } catch {
    return null
  }
  if (held !== undefined) return held.v

  try {
    const legacy = localStorage.getItem(base)
    if (legacy === null || accountCount() > 1) return null
    store(base, { v: legacy, at: 0 })
    return legacy
  } catch {
    return null
  }
}

export function scopedRecord(base: string, forScope = activeScope()): Record_ | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return parse(localStorage.getItem(keyFor(base, forScope)))
  } catch {
    return undefined
  }
}

/** True while a quota recovery is already running, so a burst of failing writes. */
let recovering = false

/** A DECISION MUST NOT LOSE TO A CACHE: `setItem` throws when the origin's storage. */
function recoverQuota(retry: () => void, _bytesNeeded: number): void {
  if (recovering) return
  recovering = true
  /* The import is dynamic so a browser that never fills its storage never loads. */
  void import('./dev-tools')
    .then(module => {
      module.clearByKind(['cache'])
      retry()
    })
    .catch(() => {
      // Nothing more to try.
    })
    .finally(() => {
      recovering = false
    })
}

function store(base: string, record: Record_, forScope = activeScope()): void {
  const key = keyFor(base, forScope)
  const value = JSON.stringify(record)
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode, or the quota.
    recoverQuota(() => {
      localStorage.setItem(key, value)
    }, (key.length + value.length) * 2)
  }
}

/** A change the reader made here, now. */
export function writeScoped(base: string, value: string): void {
  store(base, { v: value, at: Math.floor(Date.now() / 1000) })
  notify(base)
}

/** A change that arrived from another device, keeping ITS timestamp. */
export function applyScoped(base: string, value: string, at: number, forScope?: string): void {
  store(base, { v: value, at }, forScope ?? activeScope())
  // A write into another account changes nothing about what is on screen for this one.
  if (forScope === undefined || forScope === activeScope()) notify(base)
}

export function removeScoped(base: string): void {
  try {
    localStorage.removeItem(keyFor(base))
  } catch {
    // Nothing to do.
  }
  notify(base)
}

/** Copy a scope's value into the current one, if it has none of its own. */
export function inheritScoped(base: string, from: string): boolean {
  if (scopedRecord(base) !== undefined) return false
  const held = scopedRecord(base, from)
  if (held === undefined) return false
  store(base, held)
  notify(base)
  return true
}

type Listener = (base: string | undefined) => void

const listeners = new Set<Listener>()

function notify(base: string | undefined): void {
  for (const listener of listeners) listener(base)
}

/** Told when a stored preference changes: here, in another tab, or from another device. */
/** Split a real localStorage key back into the base and the account it belongs. */
export function splitScopedKey(key: string): { base: string; scope: string } | null {
  const cut = key.lastIndexOf(SEP)
  if (cut === -1) return null
  return { base: key.slice(0, cut), scope: key.slice(cut + SEP.length) }
}

/** Every real localStorage key holding a value for this base. */
export function storageKeysFor(base: string): string[] {
  if (typeof window === 'undefined') return []
  const out: string[] = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key === null) continue
      if (key === base || splitScopedKey(key)?.base === base) out.push(key)
    }
  } catch {
    // Storage unavailable.
  }
  return out
}

export function onScopedChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Another tab of the same browser is the same reader, and a setting changed there. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === null) {
      // `localStorage.clear()` elsewhere.
      notify(undefined)
      return
    }
    if (event.key === ACCOUNTS_KEY) {
      // The other tab switched accounts, added one, or signed out.
      const next = resolveScope()
      if (next !== scope) {
        scope = next
        notify(undefined)
      }
      return
    }
    const split = splitScopedKey(event.key)
    if (split === null || split.scope !== activeScope()) return
    notify(split.base)
  })
}

/** The scope resolver as source, for the two settings that must be applied. */
export const SCOPED_READER_JS =
  `(function(base){try{` +
  `var s=${JSON.stringify(ANON_SCOPE)},n=0;` +
  `var a=JSON.parse(localStorage.getItem(${JSON.stringify(ACCOUNTS_KEY)})||"null");` +
  `if(a&&a.accounts&&a.accounts.length){` +
  `var k=a.accounts.map(function(x){return x&&x.pubkey}).filter(Boolean);n=k.length;` +
  `s=typeof a.active!=="string"?k[0]:(k.indexOf(a.active)>=0?a.active:${JSON.stringify(ANON_SCOPE)});}` +
  `var r=localStorage.getItem(base+${JSON.stringify(SEP)}+s);` +
  `if(r){var p=JSON.parse(r);if(p&&typeof p.v==="string")return p.v}` +
  // Same adoption rule as readScoped: the pre-account value is only unambiguous.
  `return n>1?null:localStorage.getItem(base);` +
  `}catch(e){return null}})`
