'use client'

import { useEffect, useRef, useState } from 'react'
import { profileDisplayName, resolveNip05, toPubkey, type Hex } from '@nostrich/nostr'

import { MAX_FEEDS, MAX_TERMS, type CustomFeed, type CustomFeedsApi } from '../lib/custom-feeds'
import { normalizeHashtag } from '../lib/links'
import { useProfile } from '../lib/profiles'
import { BUTTON_PRIMARY, BUTTON_QUIET, CARD, INPUT_BASE } from '../lib/styles'
import { openModal } from '../lib/modal'
import { Avatar } from './Avatar'

/** Create or edit one of the reader's own feeds. */

export function FeedEditor({
  api,
  feed,
  seedAuthors,
  seedHashtags,
  defaultName,
  hashtagsOnly = false,
  onClose,
  onCreated,
}: {
  api: CustomFeedsApi
  /** Undefined when creating. */
  feed?: CustomFeed
  /** Accounts the new feed starts. */
  seedAuthors?: Hex[]
  /** Hashtags the new feed starts. */
  seedHashtags?: string[]
  /** Name to open. */
  defaultName?: string
  /** Hide the Accounts field. */
  hashtagsOnly?: boolean
  onClose: () => void
  onCreated?: (feed: CustomFeed) => void
}): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const editing = feed !== undefined

  const [name, setName] = useState(feed?.name ?? defaultName ?? '')
  const [hashtags, setHashtags] = useState<string[]>(feed?.hashtags ?? seedHashtags ?? [])
  const [authors, setAuthors] = useState<Hex[]>(feed?.authors ?? seedAuthors ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [authorDraft, setAuthorDraft] = useState('')
  const [authorBusy, setAuthorBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const node = ref.current
    if (node === null) return
    openModal(node)
    return () => {
      if (node.open) node.close()
    }
  }, [])

  const full = hashtags.length + authors.length >= MAX_TERMS * 2

  const addTag = (): void => {
    const tag = normalizeHashtag(tagDraft)
    if (tag === null) {
      setError('That is not a usable hashtag. One word, no spaces.')
      return
    }
    setError(null)
    setTagDraft('')
    setHashtags(current =>
      current.includes(tag) ? current : [...current, tag].slice(0, MAX_TERMS),
    )
  }

  /** Functional updater, never `[...authors, x]`. */
  const addResolved = (hex: Hex): void => {
    setAuthors(current => (current.includes(hex) ? current : [...current, hex].slice(0, MAX_TERMS)))
  }

  const addAuthor = async (): Promise<void> => {
    const raw = authorDraft.trim()
    if (raw === '') return

    // npub / nprofile / raw hex resolve synchronously.
    try {
      const hex = toPubkey(raw)
      setError(null)
      setAuthorDraft('')
      addResolved(hex)
      return
    } catch {
      // Not a key.
    }

    if (!raw.includes('@')) {
      setError('Paste an npub, or type a NIP-05 address like name@domain.com.')
      return
    }

    // A NIP-05 address needs a well-known lookup, so this branch is async and can fail.
    setAuthorBusy(true)
    setError(null)
    try {
      const resolved = await resolveNip05(raw)
      if (resolved === null) {
        setError(`Could not resolve ${raw}. Check the address, or paste their npub.`)
        return
      }
      setAuthorDraft('')
      addResolved(resolved.pubkey)
    } finally {
      setAuthorBusy(false)
    }
  }

  const save = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('Give the feed a name.')
      return
    }
    if (hashtags.length === 0 && authors.length === 0) {
      setError('Add at least one hashtag or one account.')
      return
    }
    if (editing) {
      api.update(feed.id, { name: trimmed, hashtags, authors })
      onClose()
      return
    }
    // Seeded in the create call rather than created-then-updated: two writes meant.
    const created = api.create(trimmed, { hashtags, authors })
    if (created === null) {
      setError(`You already have ${MAX_FEEDS} feeds. Delete one first.`)
      return
    }
    onCreated?.(created)
    onClose()
  }

  const destroy = (): void => {
    if (!editing) return
    api.remove(feed.id)
    onClose()
  }

  return (
    <dialog
      /* Focusable so `openModal` can put the initial focus HERE rather than letting. */
      tabIndex={-1}
      ref={ref}
      onClose={onClose}
      onClick={e => {
        if (e.target === ref.current) onClose()
      }}
      aria-label={editing ? 'Edit feed' : 'New feed'}
      className={`${CARD} m-auto w-[min(560px,92vw)] p-0 backdrop:bg-black/60 open:animate-none`}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-text">{editing ? 'Edit feed' : 'New feed'}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg px-2 text-xl leading-none text-text-muted hover:bg-bg-inset hover:text-text"
        >
          ×
        </button>
      </div>

      <div className="max-h-[70vh] space-y-5 overflow-y-auto p-4">
        <Field id="feed-name" label="Name" hint="Shown as the tab.">
          <input
            id="feed-name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={32}
            placeholder="Bitcoin, Designers, Local…"
            className={INPUT_BASE}
          />
        </Field>

        <Field
          id="feed-hashtag"
          label="Hashtags"
          hint="Notes carrying any of these appear in the feed."
        >
          <TermInput
            id="feed-hashtag"
            value={tagDraft}
            onChange={setTagDraft}
            onSubmit={addTag}
            placeholder="bitcoin"
            prefix="#"
            disabled={hashtags.length >= MAX_TERMS}
          />
          <Chips
            items={hashtags.map(tag => ({ key: tag, label: `#${tag}` }))}
            onRemove={key => setHashtags(hashtags.filter(t => t !== key))}
          />
        </Field>

        {hashtagsOnly ? null : (
        <Field id="feed-author" label="Accounts" hint="npub, nprofile, or a NIP-05 address.">
          <TermInput
            id="feed-author"
            value={authorDraft}
            onChange={setAuthorDraft}
            onSubmit={() => void addAuthor()}
            placeholder="npub1… or name@domain.com"
            busy={authorBusy}
            disabled={authors.length >= MAX_TERMS}
          />
          {authors.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {authors.map(pubkey => (
                <AuthorChip
                  key={pubkey}
                  pubkey={pubkey}
                  onRemove={() => setAuthors(authors.filter(a => a !== pubkey))}
                />
              ))}
            </ul>
          ) : null}
        </Field>
        )}

        {error !== null ? (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        ) : null}
        {full ? (
          <p className="text-xs text-text-faint">
            This feed is at its limit of {MAX_TERMS} hashtags and {MAX_TERMS} accounts.
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        {editing ? (
          <button
            type="button"
            onClick={destroy}
            disabled={authorBusy}
            className="text-sm font-medium text-danger-text hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete feed
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={BUTTON_QUIET}>
            Cancel
          </button>
          {/* Disabled while a NIP-05 address is resolving. */}
          <button
            type="button"
            onClick={save}
            disabled={authorBusy}
            className={`${BUTTON_PRIMARY} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {editing ? 'Save' : 'Create feed'}
          </button>
        </div>
      </div>
    </dialog>
  )
}

/** A labelled group. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-text">
        {label}
      </label>
      <p className="mb-2 text-xs text-text-faint">{hint}</p>
      {children}
    </div>
  )
}

/** One term, added with Enter or the button. */
function TermInput({
  id,
  value,
  onChange,
  onSubmit,
  placeholder,
  prefix,
  busy = false,
  disabled = false,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  prefix?: string
  busy?: boolean
  disabled?: boolean
}): React.ReactNode {
  return (
    <div className="flex gap-2">
      <span className="relative flex-1">
        {prefix !== undefined ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
          >
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            onSubmit()
          }}
          disabled={disabled || busy}
          placeholder={placeholder}
          className={`${INPUT_BASE} ${prefix !== undefined ? 'pl-7' : ''}`}
        />
      </span>
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || busy || value.trim() === ''}
        className={`${BUTTON_QUIET} shrink-0 disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {busy ? 'Checking…' : 'Add'}
      </button>
    </div>
  )
}

function Chips({
  items,
  onRemove,
}: {
  items: { key: string; label: string }[]
  onRemove: (key: string) => void
}): React.ReactNode {
  if (items.length === 0) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {items.map(item => (
        <li key={item.key}>
          <Chip label={item.label} onRemove={() => onRemove(item.key)} />
        </li>
      ))}
    </ul>
  )
}

function Chip({
  label,
  onRemove,
  avatar,
}: {
  label: string
  onRemove: () => void
  avatar?: React.ReactNode
}): React.ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg py-1 pl-2 pr-1 text-sm text-text">
      {avatar}
      <span className="max-w-[14rem] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="rounded-lg px-1 leading-none text-text-faint hover:bg-bg-inset hover:text-text"
      >
        ×
      </button>
    </span>
  )
}

/** An account chip, showing who it actually. */
function AuthorChip({ pubkey, onRemove }: { pubkey: Hex; onRemove: () => void }): React.ReactNode {
  const profile = useProfile(pubkey)
  const name = profileDisplayName({ ...profile, pubkey })
  return (
    <li>
      <Chip
        label={name}
        onRemove={onRemove}
        avatar={<Avatar pubkey={pubkey} name={name} picture={profile?.picture} size="sm" />}
      />
    </li>
  )
}
