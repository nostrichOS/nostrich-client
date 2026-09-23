'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { CARD, INPUT_BASE } from '../lib/styles'
import { openModal } from '../lib/modal'
import { MentionPicker } from './MentionPicker'
import { useMentionField } from '../lib/mentions'
import { npubOf } from '../lib/format'
import { sessionPubkey, useSession } from './SessionProvider'
import type { Hex } from '@nostrich/nostr'

/** Advanced search. */

export interface SearchQuery {
  include: string
  kind: 'notes' | 'profiles'
  postedBy: string
  repliesTo: string
  zappedBy: string
  since: '' | '1h' | '24h' | '7d' | '30d'
  /** Sort lives on the results, not in this dialog. */
  sort: 'recent' | 'relevance' | 'top'
}

export const EMPTY_SEARCH: SearchQuery = {
  include: '',
  kind: 'notes',
  postedBy: '',
  repliesTo: '',
  zappedBy: '',
  since: '',
  sort: 'recent',
}

export function fromSearchParams(params: URLSearchParams): SearchQuery {
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  }
  return {
    include: params.get('q') ?? '',
    kind: pick('kind', ['notes', 'profiles'] as const, 'notes'),
    postedBy: params.get('from') ?? '',
    repliesTo: params.get('to') ?? '',
    zappedBy: params.get('zapby') ?? '',
    since: pick('since', ['', '1h', '24h', '7d', '30d'] as const, ''),
    // `order=engagement` is the retired spelling of `sort=top`.
    sort:
      params.get('order') === 'engagement'
        ? 'top'
        : pick('sort', ['recent', 'relevance', 'top'] as const, 'recent'),
  }
}

export function toSearchParams(q: SearchQuery): string {
  const p = new URLSearchParams()
  // Only non-defaults are serialised, so a simple search stays a readable URL.
  if (q.include.trim() !== '') p.set('q', q.include.trim())
  if (q.kind !== 'notes') p.set('kind', q.kind)
  if (q.postedBy.trim() !== '') p.set('from', q.postedBy.trim())
  if (q.repliesTo.trim() !== '') p.set('to', q.repliesTo.trim())
  if (q.zappedBy.trim() !== '') p.set('zapby', q.zappedBy.trim())
  if (q.since !== '') p.set('since', q.since)
  if (q.sort !== 'recent') p.set('sort', q.sort)
  return p.toString()
}

/** The search controls. */
export function SearchFields({
  value,
  onChange,
}: {
  value: SearchQuery
  onChange: (next: SearchQuery) => void
}): React.ReactNode {
  const { session } = useSession()
  // Ranks the picker's rows: the people this reader follows come first.
  const viewer = sessionPubkey(session)
  const set = <K extends keyof SearchQuery>(key: K, v: SearchQuery[K]): void =>
    onChange({ ...value, [key]: v })

  return (
    <div className="space-y-3">
      <Field
        label="Include these words"
        value={value.include}
        onChange={v => set('include', v)}
        placeholder="Include these words…"
        hint="Sent to relays that implement NIP-50 search; filtered locally on those that do not."
      />
      <div className="divide-y divide-border border-y border-border">
        <Row label="Search">
          <Select
            value={value.kind}
            onChange={v => set('kind', v as SearchQuery['kind'])}
            options={[
              ['notes', 'Notes'],
              ['profiles', 'Profiles'],
            ]}
          />
        </Row>
        <Row label="Posted By" hint="npub, nprofile or a NIP-05 address">
          <Input value={value.postedBy} onChange={v => set('postedBy', v)} placeholder="Anyone" viewer={viewer} />
        </Row>
        <Row label="Replying To">
          <Input value={value.repliesTo} onChange={v => set('repliesTo', v)} placeholder="Anyone" viewer={viewer} />
        </Row>
        <Row label="Zapped By" hint="Matched against kind-9735 receipts we can see.">
          <Input value={value.zappedBy} onChange={v => set('zappedBy', v)} placeholder="Anyone" viewer={viewer} />
        </Row>
        <Row label="Time Posted">
          <Select
            value={value.since}
            onChange={v => set('since', v as SearchQuery['since'])}
            options={[
              ['', 'Anytime'],
              ['1h', 'Last hour'],
              ['24h', 'Last 24 hours'],
              ['7d', 'Last 7 days'],
              ['30d', 'Last 30 days'],
            ]}
          />
        </Row>
      </div>
    </div>
  )
}

export function AdvancedSearch({ onClose }: { onClose: () => void }): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [q, setQ] = useState<SearchQuery>(EMPTY_SEARCH)

  useEffect(() => {
    const node = ref.current
    if (node === null) return
    openModal(node)
    return () => {
      if (node.open) node.close()
    }
  }, [])

  const submit = (): void => {
    const qs = toSearchParams(q)
    router.push(qs === '' ? '/explore' : `/explore?${qs}`)
    onClose()
  }

  return (
    <dialog
      /* Focusable so `openModal` can put the initial focus HERE rather than letting. */
      tabIndex={-1}
      ref={ref}
      onClose={onClose}
      onClick={e => {
        // Backdrop clicks land on the dialog element itself, never on its children.
        if (e.target === ref.current) onClose()
      }}
      aria-label="Advanced search"
      className={`${CARD} m-auto w-[min(560px,94vw)] p-0 backdrop:bg-black/60`}
    >
      <form
        method="dialog"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-brand text-lg font-bold text-text">Advanced Search</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 text-xl leading-none text-text-muted hover:bg-bg-inset hover:text-text"
          >
            ×
          </button>
        </header>

        <div className="px-5 py-4">
          <SearchFields value={q} onChange={setQ} />
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={() => setQ(EMPTY_SEARCH)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-muted hover:bg-bg-inset"
          >
            Reset
          </button>
          <button
            type="submit"
            className="rounded-lg bg-text px-6 py-2 text-sm font-bold text-bg transition-opacity hover:opacity-90"
          >
            Search
          </button>
        </footer>
      </form>
    </dialog>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  hint: string
}): React.ReactNode {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${INPUT_BASE} rounded-lg`}
      />
      <span className="mt-1 block text-xs text-text-faint">{hint}</span>
    </label>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-[15px] text-text">{label}</span>
        {hint !== undefined ? <span className="block text-xs text-text-faint">{hint}</span> : null}
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  )
}

/** THE ARROW IS OURS, not the UA's. */
function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly (readonly [string, string])[]
}): React.ReactNode {
  return (
    <span className="relative inline-flex shrink-0">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full cursor-pointer appearance-none rounded-md border border-border bg-bg py-1.5 pl-2.5 pr-8 text-[16px] text-text focus:border-accent focus:outline-none"
      >
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  )
}

/** One field of the advanced search, with the same `@` picker the composer uses. */
function Input({
  value,
  onChange,
  placeholder,
  viewer,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Whose follows the picker should rank first, when there is a reader. */
  viewer?: Hex | undefined
}): React.ReactNode {
  const ref = useRef<HTMLTextAreaElement>(null)
  const mentions = useMentionField()

  return (
    <span className="relative">
      <textarea
        {...mentions.fieldProps}
        ref={ref}
        rows={1}
        value={value}
        onChange={e => {
          onChange(e.target.value)
          mentions.sync(e.currentTarget)
        }}
        onKeyUp={e => mentions.sync(e.currentTarget)}
        onClick={e => mentions.sync(e.currentTarget)}
        onBlur={() => mentions.dismiss()}
        placeholder={placeholder}
        /* A one-row textarea rather than an input: the picker measures and positions. */
        className="w-44 resize-none overflow-hidden rounded-md border border-border bg-bg px-2 py-1.5 text-right text-[16px] leading-[1.4] text-text placeholder:text-text-faint focus:outline-none"
      />
      {mentions.query !== undefined ? (
        <MentionPicker
          query={mentions.query}
          viewer={viewer}
          /* The npub, not the name: this field is an identifier, and `@Name` means nothing. */
          onPick={chosen => {
            onChange(npubOf(chosen))
            mentions.dismiss()
          }}
          onDismiss={mentions.dismiss}
          onActive={mentions.announce}
        />
      ) : null}
    </span>
  )
}
