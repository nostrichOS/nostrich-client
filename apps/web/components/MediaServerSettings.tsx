'use client'

import { useState } from 'react'
import { blossomOperator } from '@nostrich/nostr'

import { useMediaServers, singleOperator } from '../lib/media-servers'
import { BUTTON_PRIMARY, INPUT_BASE } from '../lib/styles'
import { sessionPubkey, sessionSigner, useSession } from './SessionProvider'

/** Where this reader's pictures go, and their say. */
export function MediaServerSettings(): React.ReactNode {
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const signer = sessionSigner(session)
  const media = useMediaServers(viewer)

  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const signedIn = viewer !== undefined

  const submit = (): void => {
    const message = media.add(draft)
    setError(message)
    if (message === null) {
      setDraft('')
      setNote(null)
    }
  }

  const onPublish = (): void => {
    if (signer === undefined) {
      setNote({ ok: false, text: 'Sign in to publish your list.' })
      return
    }
    void media.publish(signer).then(outcome => {
      setNote(
        outcome === 'ok'
          ? { ok: true, text: 'Published. Other clients will read this too.' }
          : outcome === 'declined'
            ? { ok: false, text: 'Not published, your signer did not approve it.' }
            : outcome === 'not-loaded'
              ? { ok: false, text: 'Your current list has not loaded yet. Try again in a moment.' }
              : { ok: false, text: 'No relay accepted the list. Try again.' },
      )
    })
  }

  return (
    <section aria-labelledby="media-servers-heading" className="mt-8">
      <h2 id="media-servers-heading" className="font-brand text-lg font-bold text-text">
        Media servers
      </h2>
      <p className="mt-1 max-w-prose text-[16px] leading-relaxed text-text-muted">
        Photos and videos go directly from your device to these media servers. They never pass
        through Nostrich.
        {signedIn ? ' Your preferred servers are tried first.' : ' Sign in to choose your own.'}
      </p>

      {/* The rows are the upload's real destinations, in the order it tries them. */}
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {media.effective.map(url => {
          const mine = media.servers.includes(url)
          const chosenAny = media.servers.length > 0
          return (
            <li key={url} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[15px] text-text">
                {url.replace(/^https:\/\//, '')}
              </span>
              {chosenAny && !mine ? (
                <span className="shrink-0 rounded-full bg-bg-inset px-2 py-0.5 text-xs text-text-muted">
                  default
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  media.remove(url)
                  setNote(null)
                }}
                aria-label={`Remove ${url}`}
                title={mine ? 'Remove' : 'Remove, the other defaults become your list'}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-danger-surface text-danger-text transition-colors hover:bg-danger-border disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
                  delete
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {/* TWO COPIES ARE ONLY TWO COPIES IF TWO PEOPLE HOLD THEM. */}
      {singleOperator(media.servers) ? (
        <p className="mt-3 max-w-prose text-[14px] leading-relaxed text-text-muted">
          Every server on your list is run by the same operator ({blossomOperator(media.servers[0] as string)}),
          so your uploads have one copy rather than two. Adding a server run by somebody else is
          what makes a picture survive one of them going down.
        </p>
      ) : null}

      <form
        className="mt-4 flex flex-wrap items-start gap-2"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <span className="min-w-56 flex-1">
          <label htmlFor="add-media-server" className="sr-only">
            Add a media server
          </label>
          <input
            id="add-media-server"
            value={draft}
            onChange={e => {
              setDraft(e.target.value)
              setError(null)
            }}
            placeholder="https://blossom.example.com"
            disabled={!signedIn}
            className={INPUT_BASE}
          />
          {error !== null ? (
            <span role="alert" className="mt-1 block text-[14px] text-danger-text">
              {error}
            </span>
          ) : null}
        </span>
        <button
          type="submit"
          disabled={!signedIn}
          className={`${BUTTON_PRIMARY} border border-transparent disabled:cursor-not-allowed disabled:opacity-40`}
        >
          Add
        </button>
      </form>

      {signedIn ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPublish}
            disabled={media.publishing || !media.dirty || !media.settled}
            className={`${BUTTON_PRIMARY} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {media.publishing ? 'Publishing…' : 'Publish media servers list'}
          </button>
          {media.dirty ? (
            <span className="text-[14px] text-text-muted">
              Not published yet, uploads already use this list. Publishing lets your other apps use it too.
            </span>
          ) : null}
        </div>
      ) : null}

      {note !== null ? (
        <p
          role="status"
          className={`mt-3 text-[14px] ${note.ok ? 'text-success-text' : 'text-danger-text'}`}
        >
          {note.text}
        </p>
      ) : null}

    </section>
  )
}
