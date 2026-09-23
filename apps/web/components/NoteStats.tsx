'use client'

import { useState } from 'react'
import type { NostrEvent } from '@nostrich/nostr'

import { compactCount, pluralize } from '../lib/format'
import { useEdited } from '../lib/edits'
import { useReactors } from '../lib/reactors'
import { ReactionsDialog, type ReactionTab } from './ReactionsDialog'

/** When a note was posted, and who reacted. */
export function NoteStats({ event }: { event: NostrEvent }): React.ReactNode {
  const [tab, setTab] = useState<ReactionTab | null>(null)
  const reactors = useReactors(event.id)
  /* Asked here rather than passed down: the loader batches on a 90ms window. */
  const { editedAt } = useEdited(event)

  const when = new Date(event.created_at * 1000)
  /* Formatted like the note's own stamp below rather than with `absoluteTimestamp`. */
  const editedWhen = editedAt === undefined ? undefined : new Date(editedAt * 1000)
  const editedLabel =
    editedWhen === undefined
      ? undefined
      : `${editedWhen.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${editedWhen.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const date = when.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  /** Zaps are counted in SATS, not in zaps. */
  const stats: [ReactionTab, number, string, string][] = [
    ['zaps', reactors.zapSats, 'sat', 'sats'],
    ['reposts', reactors.reposts.length, 'Repost', 'Reposts'],
    ['quotes', reactors.quotes.length, 'Quote', 'Quotes'],
    ['reactions', reactors.reactions.length, 'Reaction', 'Reactions'],
  ]
  const shown = stats.filter(([, count]) => count > 0)

  return (
    <>
      {/* The padding lives on the ROWS, not on this box. */}
      <div className="border-b border-border">
        <p className="px-4 py-3 text-[15px] text-text-muted sm:px-5">
          <time dateTime={when.toISOString()}>
            {time} · {date}
          </time>
          {/* WHEN it was corrected, on the page where there is room to say. */}
          {editedWhen === undefined ? null : (
            <>
              {' · '}
              <time dateTime={editedWhen.toISOString()}>Edited {editedLabel}</time>
            </>
          )}
        </p>

        {/* Absent while nothing has arrived, rather than a row of zeros. */}
        {shown.length === 0 ? null : (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-4 py-3 text-[15px] sm:px-5">
            {shown.map(([id, count, one, many]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className="cursor-pointer text-text-muted transition-colors hover:underline"
              >
                <span className="font-bold text-text">{compactCount(count)}</span>{' '}
                {pluralize(count, one, many)}
              </button>
            ))}
          </p>
        )}
      </div>

      {tab === null ? null : (
        <ReactionsDialog reactors={reactors} initialTab={tab} onClose={() => setTab(null)} />
      )}
    </>
  )
}
