'use client'

import { useMemo, useState } from 'react'

import {
  addTerm,
  normalizeTerm,
  removeTerm,
  termMembers,
  useUserListsVersion,
  type TermListName,
} from '../lib/user-lists'
import { hideNsfw, setHideNsfw } from '../lib/muted-content'
import { Panel } from './SettingsPanel'

/** The reader's own filters: adult content, hashtags, and words. */
export function FiltersTab(): React.ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <NsfwPanel />

      <TermPanel
        name="mutedHashtags"
        title="Muted hashtags"
        description="Notes with these hashtags are hidden from feeds, threads, and notifications. Muting a hashtag here also applies across other Nostr clients you use."
        prefix="#"
        empty="No muted hashtags."
      />

      <TermPanel
        name="mutedWords"
        title="Muted words"
        description="Notes containing these words or phrases are hidden. Only exact words are matched, so muting “art” won’t hide “start”. Matching is not case-sensitive."
        empty="No muted words."
      />
    </div>
  )
}

function NsfwPanel(): React.ReactNode {
  /* Read once into state, then written straight. */
  const [on, setOn] = useState(false)
  const [ready, setReady] = useState(false)
  if (!ready) {
    setReady(true)
    setOn(hideNsfw())
  }

  return (
    <Panel
      title="Adult content"
      description="Some authors mark their posts as adult using #nsfw or Nostr’s built-in content warning. Turning this on hides those notes across Nostrich."
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
        <span>
          <span className="block text-[16px] font-semibold text-text">Hide #nsfw content</span>
          {/* Says what it can and cannot do. */}
          <span className="block text-[14px] text-text-faint">
            Off by default. Only hides notes marked #nsfw by their author. Nostrich does not
            inspect images or guess what is adult content.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Hide #nsfw content"
          onClick={() => {
            setHideNsfw(!on)
            setOn(!on)
          }}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
            on ? 'bg-text' : 'bg-border-strong'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 size-5 rounded-full bg-bg transition-all ${
              on ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>
    </Panel>
  )
}

/** One list of terms: a field to add, and a chip per entry with a way to remove. */
function TermPanel({
  name,
  title,
  description,
  prefix = '',
  empty,
}: {
  name: TermListName
  title: string
  description: string
  prefix?: string
  empty: string
}): React.ReactNode {
  const revision = useUserListsVersion()
  const [draft, setDraft] = useState('')
  // Keyed on the store's version, so the array identity is stable until something.
  const terms = useMemo(() => [...termMembers(name)].sort(), [name, revision])

  const submit = (): void => {
    // `addTerm` normalises and refuses blanks and duplicates.
    addTerm(name, draft)
    setDraft('')
  }

  return (
    <Panel title={title} description={description}>
      <form
        onSubmit={submitEvent => {
          submitEvent.preventDefault()
          submit()
        }}
        className="flex gap-2"
      >
        {/* NO PLACEHOLDER, deliberately. */}
        <input
          value={draft}
          onChange={changeEvent => setDraft(changeEvent.target.value)}
          aria-label={title}
          // `min-w-0`, or the field refuses to shrink and pushes Add off the edge on a phone.
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-[16px] text-text outline-none focus:border-border-strong"
        />
        <button
          type="submit"
          /* A hair shorter than the field, matching the Add relay row. */
          disabled={normalizeTerm(draft) === ''}
          className="shrink-0 cursor-pointer rounded-lg bg-text px-4 py-1.5 text-[15px] font-semibold text-bg transition-opacity disabled:cursor-default disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {terms.length === 0 ? (
        <p className="mt-3 text-[14px] text-text-faint">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {terms.map(term => (
            <li key={term}>
              <button
                type="button"
                onClick={() => removeTerm(name, term)}
                aria-label={`Remove ${prefix}${term}`}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border py-1 pl-3 pr-2 text-[14px] text-text transition-colors hover:bg-bg-inset"
              >
                <span className="max-w-[16rem] truncate">
                  {prefix}
                  {term}
                </span>
                <span className="material-symbols-outlined text-[16px]! text-text-faint" aria-hidden="true">
                  close
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
