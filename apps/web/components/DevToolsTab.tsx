'use client'

import { useEffect, useState } from 'react'

import {
  clearByKind,
  clearKeys,
  inspectStorage,
  isDevMode,
  setDevMode,
  unknownKeys,
  type StoredReport,
} from '../lib/dev-tools'
import type { Hex } from '@nostrich/nostr'
import { DeleteAccountSection } from './DeleteAccountSection'

/** What this app has put on your device, and how to remove. */
export function DevToolsTab(): React.ReactNode {

  const [items, setItems] = useState<StoredReport[]>([])
  const [orphans, setOrphans] = useState<string[]>([])
  const [dev, setDev] = useState(false)
  const [flash, setFlash] = useState<string | undefined>(undefined)

  const refresh = (): void => {
    setItems(inspectStorage())
    setOrphans(unknownKeys())
    setDev(isDevMode())
  }

  // Read after mount: localStorage does not exist during the server render.
  useEffect(refresh, [])

  useEffect(() => {
    if (flash === undefined) return
    const timer = setTimeout(() => setFlash(undefined), 2_500)
    return () => clearTimeout(timer)
  }, [flash])

  const present = items.filter(item => item.present)
  const bytes = present.reduce((total, item) => total + item.bytes, 0)
  const caches = present.filter(item => item.kind === 'cache')
  const prefs = present.filter(item => item.kind === 'preference')

  const run = (message: string, action: () => void): void => {
    if (!window.confirm(message)) return
    action()
    refresh()
    setFlash('Done')
  }

  return (
    <div className="mt-5 space-y-8">
      <section>
        <h2 className="text-sm font-semibold text-text">On this device</h2>
        <p className="mb-3 text-xs leading-relaxed text-text-faint">
          Nostrich keeps nothing about you on a server. Everything it remembers is here, in
          this browser, and is listed in full below.
        </p>
        <p className="text-sm text-text-muted">
          {present.length} {present.length === 1 ? 'item' : 'items'}, about{' '}
          {bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024).toLocaleString()} KB`}.
        </p>

        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {present.map(item => (
            <li key={item.key} className="flex items-start gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-text">{item.label}</span>
                  <Badge kind={item.kind} />
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-text-faint">
                  {item.cost}
                </span>
                {dev ? (
                  <span className="mt-1 block font-mono text-[11px] text-text-faint">
                    {item.key} · {item.bytes.toLocaleString()} B
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() =>
                  run(`Clear "${item.label}"?\n\n${item.cost}`, () => clearKeys([item.key]))
                }
                className="shrink-0 cursor-pointer rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
              >
                Clear
              </button>
            </li>
          ))}
          {present.length === 0 ? (
            <li className="px-4 py-3 text-sm text-text-muted">Nothing stored yet.</li>
          ) : null}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-text">Clean up</h2>
        <p className="mb-3 text-xs leading-relaxed text-text-faint">
          Caches are rebuilt from relays automatically. Preferences are not, they exist only
          here, so clearing them is permanent.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={caches.length === 0}
            onClick={() =>
              run(
                'Clear cached names, avatars and the timeline snapshot?\n\nThey are re-fetched from relays. The next load will be slower.',
                () => clearByKind(['cache']),
              )
            }
            className="cursor-pointer rounded-lg border border-border px-3.5 py-2 text-sm text-text transition-colors hover:bg-bg-inset disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear caches
          </button>
          <button
            type="button"
            disabled={prefs.length === 0}
            onClick={() =>
              run(
                'Reset every preference?\n\nCustom feeds, mutes, drafts and saved settings are stored only on this device and cannot be recovered.',
                () => clearByKind(['preference']),
              )
            }
            className="cursor-pointer rounded-lg border border-border px-3.5 py-2 text-sm text-text transition-colors hover:bg-bg-inset disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset preferences
          </button>
          {orphans.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                run(
                  `Remove ${orphans.length} unrecognised item(s) left by an older version?`,
                  () => clearKeys(orphans),
                )
              }
              className="cursor-pointer rounded-lg border border-border px-3.5 py-2 text-sm text-text transition-colors hover:bg-bg-inset"
            >
              Remove {orphans.length} leftover
            </button>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-text">Developer mode</h2>
        <p className="mb-3 text-xs leading-relaxed text-text-faint">
          Shows storage keys and sizes on this page. It changes nothing else, no hidden
          behaviour is switched on by it.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={dev}
          onClick={() => {
            setDevMode(!dev)
            setDev(!dev)
          }}
          className={`relative h-6 w-11 cursor-pointer rounded-full transition-colors ${
            dev ? 'bg-text' : 'bg-border-strong'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 size-5 rounded-full bg-bg transition-all ${
              dev ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </section>

      {flash !== undefined ? (
        <p role="status" className="text-sm text-text-muted">
          {flash}
        </p>
      ) : null}

      {/* Last, and below a rule. */}
      <DeleteAccountSection />
    </div>
  )
}

function Badge({ kind }: { kind: StoredReport['kind'] }): React.ReactNode {
  const label =
    kind === 'cache' ? 'Cache' : kind === 'preference' ? 'Preference' : kind === 'private' ? 'Private' : 'Identity'
  const tone =
    kind === 'identity' || kind === 'private'
      ? 'border-danger-border text-danger-text'
      : 'border-border text-text-faint'
  return (
    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  )
}

