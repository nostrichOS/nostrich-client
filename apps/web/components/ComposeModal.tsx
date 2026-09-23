'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { relativeTime } from '../lib/format'
import { removeDraft, saveDraft, useDrafts } from '../lib/drafts'
import { CARD } from '../lib/styles'
import { openModal } from '../lib/modal'
import { useNowSeconds } from './Clock'
import { Composer } from './Composer'

/** The Post button's dialog. */
export function ComposeModal({
  onClose,
  initialContent,
  quoting,
  initialFiles,
  initialMentions,
}: {
  onClose: () => void
  /** Seeds the field. */
  initialContent?: string
  /** The note being quoted. */
  quoting?: { id: string; pubkey: string }
  /** Attached on open, as though just picked. */
  initialFiles?: readonly File[]
  /** `@Name` -> pubkey for tokens the opener seeded into the text. */
  initialMentions?: Record<string, string>
}): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const drafts = useDrafts()
  const now = useNowSeconds()

  const [text, setText] = useState(initialContent ?? '')
  /** The composer's publish action, lifted so the header can press. */
  const [actions, setActions] = useState<{
    canPost: boolean
    publishing: boolean
    uploading: boolean
    publish: () => void
  } | null>(null)
  const onActions = useCallback(
    (next: { canPost: boolean; publishing: boolean; uploading: boolean; publish: () => void }) =>
      setActions(next),
    [],
  )
  const [resumed, setResumed] = useState<{
    id: string
    text: string
    mentions?: Record<string, string>
  } | null>(null)
  /** The composer's `@Name` -> pubkey bindings, mirrored here because THIS is what saves. */
  const [mentions, setMentions] = useState<Record<string, string>>(initialMentions ?? {})
  const [showDrafts, setShowDrafts] = useState(false)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (node === null) return
    openModal(node)
    /** THE PAGE BEHIND DOES NOT SCROLL WHILE THIS IS OPEN. */
    const held = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = held
      if (node.open) node.close()
    }
  }, [])

  /** Closing with unsent text asks first. */
  const attemptClose = (): void => {
    if (text.trim() === '') {
      onClose()
      return
    }
    setAsking(true)
  }

  const keep = (): void => {
    saveDraft(text, resumed?.id, mentions)
    onClose()
  }

  const discard = (): void => {
    // The draft being resumed goes too: the reader chose to throw this text away.
    if (resumed !== null) removeDraft(resumed.id)
    onClose()
  }

  return (
    <dialog
      /* Focusable so `openModal` can put the initial focus HERE rather than letting. */
      tabIndex={-1}
      ref={ref}
      onCancel={event => {
        /** The file picker also fires `cancel`, and it bubbles. */
        if (event.target !== event.currentTarget) return
        // Escape fires `cancel` before `close`.
        event.preventDefault()
        attemptClose()
      }}
      onClose={onClose}
      onClick={event => {
        if (event.target === ref.current) attemptClose()
      }}
      aria-label="Write a note"
      // `mb-auto` with a small top margin is what pins it up: the default `m-auto` centres.
      /** `overflow-visible` matters. */
      /** The desktop card is EXACTLY what it always. */
      className={`${CARD} mx-auto mb-auto mt-[6vh] w-[min(600px,94vw)] overflow-visible p-0 backdrop:bg-black/60 open:animate-none max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none`}
    >
      {/* A column on a phone, so the field takes the space left over and the toolbar stays. */}
      <div className="max-sm:flex max-sm:h-full max-sm:flex-col">
      <div className="flex items-center justify-between px-4 py-3 max-sm:shrink-0 max-sm:border-b max-sm:border-border">
        {/* CANCEL as a word on a phone, ✕ on a desktop. */}
        <button
          type="button"
          onClick={attemptClose}
          aria-label="Close"
          // `border` (#e5e5e5), not `bg-inset` (#f5f5f5).
          /* On a phone, `max-sm:-ml-3` cancels `max-sm:px-3` exactly, so the WORD starts. */
          className="-ml-2 flex size-9 items-center justify-center rounded-full text-text transition-colors hover:bg-border max-sm:-ml-3 max-sm:size-auto max-sm:px-3 max-sm:py-1.5 max-sm:text-[15px] max-sm:font-bold"
        >
          <span aria-hidden="true" className="hidden max-sm:inline">
            Cancel
          </span>
          {/* The ✕ is wrapped in a PLAIN span, and the wrapper is what hides. */}
          {/* `flex`, not `inline`. */}
          <span aria-hidden="true" className="flex items-center justify-center max-sm:hidden">
            <span className="material-symbols-outlined text-[22px]! leading-none">close</span>
          </span>
        </button>

        <div className="flex items-center gap-2">

        {/* Always shown and always clickable. */}
        <button
          type="button"
          onClick={() => setShowDrafts(open => !open)}
          // Same hover as the close button beside it, one step darker than the surface tint.
          className="rounded-lg px-3 py-1.5 text-[15px] font-bold text-text transition-colors hover:bg-border"
        >
          {showDrafts ? 'Back' : `Drafts${drafts.length > 0 ? ` (${drafts.length})` : ''}`}
        </button>

        {/* POST, on a phone only. */}
        {showDrafts ? null : (
          <button
            type="button"
            onClick={() => actions?.publish()}
            disabled={actions === null || !actions.canPost}
            aria-busy={actions?.publishing === true}
            className="hidden rounded-full bg-text px-5 py-1.5 text-[15px] font-bold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 max-sm:block"
          >
            {actions?.publishing === true
              ? 'Posting…'
              : actions?.uploading === true
                ? 'Uploading…'
                : 'Post'}
          </button>
        )}
        </div>
      </div>

      {showDrafts && drafts.length === 0 ? (
        <p className="border-y border-border px-4 py-10 text-center text-sm text-text-muted">
          No drafts yet.
        </p>
      ) : showDrafts ? (
        <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto border-y border-border">
          {drafts.map(draft => (
            <li key={draft.id} className="flex items-start gap-2 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setResumed({
                    id: draft.id,
                    text: draft.text,
                    ...(draft.mentions === undefined ? {} : { mentions: draft.mentions }),
                  })
                  setText(draft.text)
                  setShowDrafts(false)
                }}
                className="min-w-0 flex-1 text-left"
              >
                <span className="line-clamp-2 text-sm text-text">{draft.text}</span>
                <span className="mt-1 block text-xs text-text-faint">
                  {now === 0 ? null : relativeTime(draft.savedAt, now)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => removeDraft(draft.id)}
                aria-label="Delete draft"
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-danger-text hover:bg-bg-inset"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div
          /* NO horizontal padding on a phone: `Composer` already carries `px-4`, and adding. */
          className="px-4 pb-4 max-sm:min-h-0 max-sm:flex-1 max-sm:overflow-y-auto max-sm:px-0"
        >
          {/* Keyed on the resumed draft so picking one remounts the composer with its text. */}
          <Composer
            key={resumed?.id ?? 'new'}
            initialContent={resumed?.text ?? initialContent ?? ''}
            initialFiles={initialFiles}
            /* The modal's own copy, not just the resumed draft's. */
            initialMentions={resumed?.mentions ?? mentions}
            quoting={quoting}
            onContentChange={setText}
            onMentionsChange={setMentions}
            onActions={onActions}
            autoFocus
            hidePostButton
            // The dialog cannot grow past the viewport.
            scrollBody
            bordered={false}
            onPublished={event => {
              // So the note shows up in whatever feed is behind this dialog, immediately, rather.
              if (resumed !== null) removeDraft(resumed.id)
              onClose()
            }}
            onRejected={() => undefined}
          />
        </div>
      )}

      {/* Asked inside the dialog rather than with window.confirm, which is unstyled, blocks. */}
      {asking ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 p-4">
          <div className="w-full max-w-[320px] rounded-lg border border-border bg-bg-elevated p-5 text-center shadow-lg">
            <p className="text-base font-bold text-text">Save this to drafts?</p>
            <p className="mt-1 text-sm text-text-muted">You can finish it later.</p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={keep}
                className="w-full rounded-lg bg-text px-4 py-2 text-sm font-bold text-bg transition-opacity hover:opacity-90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={discard}
                className="w-full rounded-lg border border-border px-4 py-2 text-sm font-semibold text-danger-text transition-colors hover:bg-bg-inset"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-text-muted transition-colors hover:bg-bg-inset"
              >
                Keep writing
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </dialog>
  )
}
