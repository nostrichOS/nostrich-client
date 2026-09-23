'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { profileDisplayName, type Hex } from '@nostrich/nostr'

import { npubOf } from '../lib/format'
import { readCachedProfile } from '../lib/profile-cache'

import { useFollows } from '../lib/contacts'
import { useProfileSearch } from '../lib/profile-search'
import { useProfile } from '../lib/profiles'
import { Avatar } from './Avatar'

/** The account picker that opens while typing `@`. */

/** Rows built. */
const MAX_ROWS = 50

/** Shared with the fields, which name it in `aria-controls`. */
export const MENTION_LISTBOX_ID = 'mention-listbox'

export interface MentionQuery {
  /** The word being typed, without the `@`. */
  term: string
  /** Where the `@` sits, so the caller can replace from there. */
  start: number
  end: number
}

/** The `@handle` under the caret, if there is one. */
export function mentionAt(value: string, caret: number): MentionQuery | undefined {
  const before = value.slice(0, caret)
  const match = /(^|\s)@([\w./-]*)$/.exec(before)
  if (match === null) return undefined
  const term = match[2] ?? ''
  return { term, start: caret - term.length - 1, end: caret }
}

/** The panel's width when it is anchored to the caret rather than stretched. */
export const MENTION_PANEL_WIDTH = 320

/** Follows occupy ranks 0-5. */
const FOLLOW_TIER = 6

/** Which field matched, and how well. */
function fieldRank(profile: { name?: string; displayName?: string; nip05?: string }, needle: string): number | undefined {
  const fields = [profile.name, profile.displayName, profile.nip05]
  for (const [index, raw] of fields.entries()) {
    const value = (raw ?? '').toLowerCase().trim()
    if (value === '') continue
    if (value.startsWith(needle)) return index * 2
    if (value.includes(needle)) return index * 2 + 1
  }
  return undefined
}

export function MentionPicker({
  query,
  viewer,
  onPick,
  onDismiss,
  onActive,
  placement = 'down',
  field,
  anchor,
}: {
  query: MentionQuery
  viewer: Hex | undefined
  onPick: (pubkey: Hex, name: string) => void
  onDismiss: () => void
  /** Reports the active row's element id, for the field's `aria-activedescendant`. */
  onActive?: (id: string | undefined) => void
  /** Which way the list opens. */
  placement?: 'down' | 'up'
  /** The field this list belongs to, when it is not a textarea. */
  field?: HTMLElement | null
  /** Where to hang the panel, in its positioned parent's coordinates. */
  anchor?: { top: number; left: number }
}): React.ReactNode {
  const follows = useFollows(viewer)
  // The index is only asked once there is something to ask.
  const remote = useProfileSearch(query.term, query.term.trim().length >= 2)
  const [active, setActive] = useState(0)

  const candidates = useMemo((): Hex[] => {
    const needle = query.term.trim().replace(/^@+/, '').toLowerCase()
    const seen = new Set<Hex>()
    const ranked: { pubkey: Hex; rank: number }[] = []

    const consider = (pubkey: Hex, base: number): void => {
      if (seen.has(pubkey)) return
      seen.add(pubkey)

      if (needle === '') {
        ranked.push({ pubkey, rank: base })
        return
      }

      // Read from the synchronous disk cache, not from a hook.
      const cached = readCachedProfile(pubkey)?.profile
      if (cached === undefined) return
      const field = fieldRank(cached, needle)
      if (field === undefined) return
      ranked.push({ pubkey, rank: base + field })
    }

    // Follows first and at a better rank: they are who gets mentioned, and they need.
    for (const pubkey of follows.all) consider(pubkey, 0)
    // The index fills in everyone else.
    for (const hit of remote.profiles) {
      if (seen.has(hit.pubkey)) continue
      seen.add(hit.pubkey)
      // Ranked below every followed account regardless of how well it matches: someone.
      ranked.push({ pubkey: hit.pubkey, rank: FOLLOW_TIER + 1 })
    }

    return ranked
      .sort((a, b) => a.rank - b.rank)
      .slice(0, MAX_ROWS)
      .map(entry => entry.pubkey)
  }, [follows.all, remote.profiles, query.term])

  useEffect(() => {
    setActive(0)
  }, [query.term])

  /** The active row's id, told to the field so a screen reader follows the selection. */
  const activeId = candidates[active] === undefined ? undefined : `mention-${candidates[active]}`
  useEffect(() => {
    onActive?.(activeId)
    // Cleared on the way out, so a stale id never points at an element that has gone.
    return () => onActive?.(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reports the value, not the callback
  }, [activeId])

  /** The name each row settled on, reported back so a KEY can commit the same string. */
  const labels = useRef(new Map<Hex, string>())

  const commit = useCallback(
    (pubkey: Hex | undefined): boolean => {
      if (pubkey === undefined) return false
      const label = labels.current.get(pubkey)
      // No name yet means the row is still resolving.
      if (label === undefined || label === '') return false
      onPick(pubkey, label)
      return true
    },
    [onPick],
  )

  /** THE PICKER IS DRIVEN BY THE KEYBOARD, not only by the mouse. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Nothing to drive.
      if (candidates.length === 0) return
      // Only while the field this list belongs to is the one being typed.
      const focused = document.activeElement
      if (field != null ? focused !== field : focused?.tagName !== 'TEXTAREA') return
      /* MID-COMPOSITION KEYS BELONG TO THE IME, not to this list. */
      if (event.isComposing) return
      // Cmd/Ctrl+Enter is "send" and Alt-anything is somebody's system shortcut.
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        // Wraps, so holding one arrow reaches every row without hunting for the other.
        setActive(current => (current + step + candidates.length) % candidates.length)
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        // Shift+Enter is a newline and Shift+Tab is "focus the previous control".
        if (event.shiftKey) return
        if (!commit(candidates[active])) return
        event.preventDefault()
        // The textarea's own handler would otherwise still see this Enter.
        event.stopPropagation()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [candidates, active, commit, field])

  /* NOTHING FOUND IS SOMETHING TO SAY. */
  if (candidates.length === 0) {
    const searching = remote.loading
    const message = searching
      ? 'Searching…'
      : remote.degraded
        ? 'Search is unavailable right now'
        : query.term.trim() === ''
          ? 'Type a name to search'
          : `No accounts match “${query.term.trim()}”`

    return (
      <div
        role="status"
        {...(anchor === undefined ? {} : { style: { top: anchor.top, left: anchor.left, width: MENTION_PANEL_WIDTH } })}
        className={`absolute z-50 rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-muted shadow-lg ${
          anchor !== undefined ? 'mt-1' : placement === 'up' ? 'left-0 right-0 bottom-full mb-1' : 'left-0 right-0 top-full mt-1'
        }`}
      >
        {message}
      </div>
    )
  }

  return (
    <div
      id={MENTION_LISTBOX_ID}
      role="listbox"
      aria-label="Mention someone"
      {...(anchor === undefined ? {} : { style: { top: anchor.top, left: anchor.left, width: MENTION_PANEL_WIDTH } })}
      className={`absolute z-50 max-h-72 overflow-y-auto rounded-lg border border-border bg-bg-elevated py-1 shadow-lg ${
        anchor !== undefined ? 'mt-1' : placement === 'up' ? 'left-0 right-0 bottom-full mb-1' : 'left-0 right-0 top-full mt-1'
      }`}
    >
      {candidates.map((pubkey, index) => (
        <MentionRow
          key={pubkey}
          id={`mention-${pubkey}`}
          pubkey={pubkey}
          active={index === active}
          onHover={() => setActive(index)}
          onPick={name => onPick(pubkey, name)}
          onLabel={label => labels.current.set(pubkey, label)}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  )
}

function MentionRow({
  id,
  pubkey,
  active,
  onHover,
  onPick,
  onLabel,
}: {
  /** Stable per account, so `aria-activedescendant` can point. */
  id: string
  pubkey: Hex
  active: boolean
  onHover: () => void
  onPick: (name: string) => void
  /** Reports the exact token this row would insert, so the keyboard can insert the same. */
  onLabel: (label: string) => void
  onDismiss: () => void
}): React.ReactNode {
  const profile = useProfile(pubkey)
  const name = profileDisplayName(profile ?? { pubkey })
  const handle = profile?.nip05 ?? ''
  /** The username is what goes in the note, when there is one. */
  const token = profile?.name?.trim() !== undefined && profile.name.trim() !== '' ? profile.name : name

  // Told upward whenever it changes, because the profile behind it usually arrives.
  const label = mentionLabel(token)
  useEffect(() => {
    onLabel(label)
    // `onLabel` is a fresh closure every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label])

  /** Keeps the keyboard's selection on screen in a list that scrolls to fifty rows. */
  const node = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (active) node.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      ref={node}
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      // mousedown, not click: the textarea loses focus on mousedown, and a blur handler.
      onMouseDown={pickEvent => {
        pickEvent.preventDefault()
        onPick(label)
      }}
      className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors ${
        active ? 'bg-bg-inset' : 'hover:bg-bg-inset'
      }`}
    >
      <Avatar pubkey={pubkey} name={name} picture={profile?.picture} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text">{name}</span>
        <span className="block truncate text-xs text-text-muted">
          {handle !== '' ? handle : `${npubOf(pubkey).slice(0, 16)}…`}
        </span>
      </span>
    </button>
  )
}

/** The `@token` written into the draft. */
function mentionLabel(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}
