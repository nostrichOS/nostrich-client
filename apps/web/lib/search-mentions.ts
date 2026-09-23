'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Hex } from '@nostrich/nostr'

import { mentionAt, type MentionQuery } from '../components/MentionPicker'
import { npubOf } from './format'
import { profileHref } from './links'

/** `@` IN A SEARCH BOX MEANS THE SAME THING IT MEANS IN THE COMPOSER. */
export interface SearchMentions {
  /** The `@term` under the caret, or undefined when there is none. */
  query: MentionQuery | undefined
  /** Recompute from the field's value and caret. */
  sync: (node: HTMLInputElement | null) => void
  dismiss: () => void
  /** Where a pick goes. Clears the list first so it cannot linger over the next page. */
  pick: (pubkey: Hex) => void
}

export function useSearchMentions(): SearchMentions {
  const router = useRouter()
  const [query, setQuery] = useState<MentionQuery | undefined>(undefined)

  const sync = useCallback((node: HTMLInputElement | null): void => {
    if (node === null) {
      setQuery(undefined)
      return
    }
    setQuery(mentionAt(node.value, node.selectionStart ?? node.value.length))
  }, [])

  const dismiss = useCallback((): void => setQuery(undefined), [])

  const pick = useCallback(
    (pubkey: Hex): void => {
      setQuery(undefined)
      router.push(profileHref(npubOf(pubkey)))
    },
    [router],
  )

  return { query, sync, dismiss, pick }
}
