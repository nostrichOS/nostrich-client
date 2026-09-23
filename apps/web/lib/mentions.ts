'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { Hex } from '@nostrich/nostr'

import { npubOf } from './format'
import { mentionAt, MENTION_LISTBOX_ID, type MentionQuery } from '../components/MentionPicker'

/** Where a remembered `@Name` actually sits in a draft. */
export interface MentionRange {
  start: number
  end: number
  token: string
}

/* `/` and `:` are in here for the same reason `.` and `@` are: a URL is not a sentence. */
const BOUNDARY_BEFORE = /[\w@./:]/u
const BOUNDARY_AFTER = /[\w-]/u

export function mentionRanges(text: string, tokens: Iterable<string>): MentionRange[] {
  const ordered = [...tokens].filter(token => token !== '').sort((a, b) => b.length - a.length)
  const found: MentionRange[] = []
  const taken: boolean[] = new Array(text.length).fill(false)

  for (const token of ordered) {
    let from = 0
    for (;;) {
      const at = text.indexOf(token, from)
      if (at < 0) break
      const end = at + token.length
      from = at + 1

      const before = at === 0 ? '' : text.charAt(at - 1)
      if (before !== '' && BOUNDARY_BEFORE.test(before)) continue
      const after = text.charAt(end)
      if (after !== '' && BOUNDARY_AFTER.test(after)) continue
      // A longer token already claimed these characters.
      let free = true
      for (let index = at; index < end; index += 1) if (taken[index] === true) free = false
      if (!free) continue

      for (let index = at; index < end; index += 1) taken[index] = true
      found.push({ start: at, end, token })
    }
  }

  return found.sort((a, b) => a.start - b.start)
}

/** Every remembered `@Name` in `text`, swapped for the pointer it stands. */
export function applyMentions(text: string, tokens: ReadonlyMap<string, Hex>): string {
  const ranges = mentionRanges(text, tokens.keys())
  let out = ''
  let cursor = 0
  for (const range of ranges) {
    const pubkey = tokens.get(range.token)
    if (pubkey === undefined) continue
    out += text.slice(cursor, range.start) + `nostr:${npubOf(pubkey)}`
    cursor = range.end
  }
  return out + text.slice(cursor)
}

/** @-mention support for any text field that publishes. */
export interface MentionField {
  /** The `@word` under the caret, or undefined. */
  query: MentionQuery | undefined
  /** Call on change, keyup and click. */
  sync: (node: HTMLTextAreaElement | null) => void
  /** Close without touching the draft. */
  dismiss: () => void
  /** Replace the typed `@word` with the chosen account's name, and remember what it means. */
  apply: (
    node: HTMLTextAreaElement | null,
    value: string,
    pubkey: Hex,
    name: string,
    setValue: (next: string) => void,
  ) => void
  /** Swap every remembered `@Name` for its `nostr:npub…` pointer. */
  resolve: (text: string) => string
  /** The tokens currently remembered, for the highlight layer. */
  tokens: readonly string[]
  /** `@Name` -> pubkey, for a draft that has to survive the composer being closed. */
  bindings: Record<string, string>
  /** Props for the field the picker belongs to, so a screen reader can follow. */
  fieldProps: {
    role: 'combobox'
    'aria-expanded': boolean
    'aria-controls': string
    'aria-autocomplete': 'list'
    'aria-activedescendant': string | undefined
  }
  /** Called by the picker with the active row's element id. */
  announce: (id: string | undefined) => void
  /** Forget every remembered token. */
  clear: () => void
  /** Adopt `@handle` -> pubkey bindings the caller worked out for itself. */
  remember: (bindings: Record<string, string>) => void
}

export function useMentionField(
  /** Bindings to start with, from a resumed draft. */
  seed?: Record<string, string>,
): MentionField {
  const [query, setQuery] = useState<MentionQuery | undefined>(undefined)
  /** `@name` as typed -> the pubkey it stands. */
  const [tokens, setTokens] = useState<ReadonlyMap<string, Hex>>(
    () => new Map(Object.entries(seed ?? {}) as [string, Hex][]),
  )
  const live = useRef<ReadonlyMap<string, Hex>>(tokens)
  live.current = tokens

  const sync = useCallback((node: HTMLTextAreaElement | null): void => {
    if (node === null) return
    setQuery(mentionAt(node.value, node.selectionStart))
  }, [])

  const dismiss = useCallback((): void => setQuery(undefined), [])

  const apply = useCallback(
    (
      node: HTMLTextAreaElement | null,
      value: string,
      pubkey: Hex,
      name: string,
      setValue: (next: string) => void,
    ): void => {
      const token = `@${name}`
      setTokens(current => new Map(current).set(token, pubkey))
      setQuery(current => {
        if (current === undefined) return undefined
        /* NO TRAILING SPACE. */
        setValue(value.slice(0, current.start) + token + value.slice(current.end))
        requestAnimationFrame(() => {
          if (node === null) return
          node.focus()
          node.selectionStart = node.selectionEnd = current.start + token.length
        })
        return undefined
      })
    },
    [],
  )

  const resolve = useCallback((text: string): string => applyMentions(text, live.current), [])

  const clear = useCallback((): void => setTokens(new Map()), [])

  const remember = useCallback((bindings: Record<string, string>): void => {
    const entries = Object.entries(bindings)
    if (entries.length === 0) return
    setTokens(current => {
      // Nothing new is not a state update: this runs from an effect that re-fires whenever.
      if (entries.every(([token, pubkey]) => current.get(token) === pubkey)) return current
      const next = new Map(current)
      for (const [token, pubkey] of entries) next.set(token, pubkey as Hex)
      return next
    })
  }, [])

  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const announce = useCallback((id: string | undefined): void => setActiveId(id), [])

  const names = useMemo((): string[] => [...tokens.keys()], [tokens])
  const bindings = useMemo((): Record<string, string> => Object.fromEntries(tokens), [tokens])

  const fieldProps = useMemo(
    () =>
      ({
        role: 'combobox' as const,
        'aria-expanded': query !== undefined,
        'aria-controls': MENTION_LISTBOX_ID,
        'aria-autocomplete': 'list' as const,
        'aria-activedescendant': query === undefined ? undefined : activeId,
      }),
    [query, activeId],
  )

  return { query, sync, dismiss, apply, resolve, tokens: names, bindings, clear, remember, fieldProps, announce }
}
