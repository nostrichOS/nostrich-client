'use client'

import { useState } from 'react'

import { DEFAULT_RELAYS, DEFAULT_RELAY_ENTRIES } from '@nostrich/nostr'

import { sameRelayList, type RelayPolicyChoice } from '../lib/relay-cookie'
import { useRelayListHealth } from '../lib/relay-list-health'
import { useRelayPrefs } from '../lib/relay-prefs'
import { useRelayStatus } from '../lib/relay-status'
import { BUTTON_PRIMARY, BUTTON_QUIET, INPUT_BASE } from '../lib/styles'
import { sessionPubkey, useSession } from './SessionProvider'

/** Relay management, as a section of Settings rather than a page of its own. */
/** Named for what the relay DOES for the reader, not for the tag it becomes. */
const POLICY_LABEL: Readonly<Record<RelayPolicyChoice, string>> = {
  both: 'read + write',
  read: 'read only',
  write: 'write only',
}

const POLICY_HELP: Readonly<Record<RelayPolicyChoice, string>> = {
  both: 'Others find your notes here, and send your replies here.',
  read: 'Replies are sent here. You do not publish here.',
  write: 'Your notes are published here. Replies are sent elsewhere.',
}

/** What limiting THIS relay costs, shown on its own row. */
const POLICY_EFFECT: Readonly<Record<RelayPolicyChoice, string | undefined>> = {
  both: undefined,
  read: 'Your notes are not published here.',
  write: 'Others will not send your replies here.',
}

/** The shipped policies, for telling "already on the defaults" from "edited to look. */
const DEFAULT_POLICIES: Readonly<Record<string, RelayPolicyChoice>> = Object.fromEntries(
  DEFAULT_RELAY_ENTRIES.filter(e => !(e.policy.read && e.policy.write)).map(e => [
    e.url as string,
    e.policy.read ? 'read' : 'write',
  ]),
)

export function RelaySettings(): React.ReactNode {
  const {
    relays, source, add, remove, reset,
    restorePublished, restoring, canRestorePublished,
    publish, publishing, needsPublish,
    setPolicy, policies,
  } = useRelayPrefs()
  const status = useRelayStatus()
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const signedIn = viewer !== undefined

  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** What the last restore attempt found, so "you have no published list" can be said. */
  const [restoreNote, setRestoreNote] = useState<string | null>(null)
  /** The result of the last publish, and whether it went well. */
  const [publishNote, setPublishNote] = useState<{ ok: boolean; text: string } | null>(null)
  /* Asked per relay rather than merged. */
  /** Bumped after a publish so the sweep re-runs and the new entry's policy appears. */
  const [sweep, setSweep] = useState(0)
  const health = useRelayListHealth(viewer, relays, signedIn, sweep)

  const submit = (): void => {
    if (draft.trim() === '') return
    const failure = add(draft)
    setError(failure)
    if (failure === null) setDraft('')
  }

  const onRestorePublished = (): void => {
    setRestoreNote(null)
    void restorePublished().then(outcome => {
      // "You have not published one" is an answer, not a failure.
      if (outcome === 'ok') setRestoreNote(null)
      else if (outcome === 'none') setRestoreNote('You have not published a relay list yet.')
      else setRestoreNote('Could not reach the relays to check. Try again in a moment.')
    })
  }

  const onPublish = (): void => {
    setPublishNote(null)
    /* `.catch` as well as `.then`, because a rejection here shows the reader NOTHING. */
    void publish().then(outcome => {
      /* Swept again on success, after a beat. */
      if (outcome === 'ok') setTimeout(() => setSweep(current => current + 1), 1_000)
      setPublishNote(
        outcome === 'ok'
          ? { ok: true, text: 'Published. Other clients will pick these up as your relays.' }
          : {
              ok: false,
              text:
                outcome === 'declined'
                  ? 'Not published, your signer did not approve it.'
                  : outcome === 'no-signer'
                    ? 'Publishing needs a key that can sign. You are signed in read-only.'
                    : 'No relay accepted the list. Try again in a moment.',
            },
      )
    }).catch(() => {
      setPublishNote({ ok: false, text: 'Something went wrong while publishing. Try again.' })
    })
  }

  const stateOf = (url: string): string => status.find(s => s.url === url)?.state ?? 'connecting'

  /* The rows: the reader's own list, plus anything they PUBLISHED that this app does. */
  const policyOf = (url: string): { read: boolean; write: boolean } | undefined =>
    health.entries.find(entry => (entry.url as string) === url)?.policy

  const unread = health.entries
    .filter(entry => !relays.includes(entry.url as string) && !entry.policy.read)
    .map(entry => entry.url as string)
  const rows = [...relays, ...unread]
  /** The list on screen is exactly what we ship, policies included. */
  const onDefaults =
    sameRelayList(relays, DEFAULT_RELAYS) &&
    rows.every(url => (policies[url] ?? 'both') === (DEFAULT_POLICIES[url] ?? 'both'))

  /** The only two states worth interrupting the reader. */
  const effective = (url: string): RelayPolicyChoice => policies[url] ?? 'both'
  const broken =
    relays.length === 0
      ? null
      : relays.every(url => effective(url) === 'write')
        ? 'No relay is set to receive replies. Mentions and replies to you will not arrive.'
        : relays.every(url => effective(url) === 'read')
          ? 'No relay is set to publish to. Your notes will not be sent anywhere.'
          : null

  return (
    <section aria-labelledby="relays-heading" className="mt-8">
      <h2 id="relays-heading" className="font-brand text-lg font-bold text-text">
        Relays
      </h2>
      <p className="mt-1 max-w-prose text-[16px] leading-relaxed text-text-muted">
        Your notes are read from and published directly to these relays.
        {signedIn
          ? ' If you already have a published relay list, we use it. Changes you make here stay on this device until you publish them.'
          : ' Saved on this device, so they survive a reload without a key.'}
      </p>

      <ul className="mt-4 divide-y divide-border border-y border-border">
        {rows.map(url => {
          const listed = relays.includes(url)
          /* SUBSCRIBED is now about the POLICY, not about presence. */
          const subscribed = listed && (policies[url] ?? 'both') !== 'write'
          const state = subscribed ? stateOf(url) : 'idle'
          const policy = policyOf(url)
          /* What the row shows: the reader's own choice if they made one, else. */
          const choice: RelayPolicyChoice =
            policies[url] ??
            (policy === undefined || (policy.read && policy.write)
              ? 'both'
              : policy.read
                ? 'read'
                : 'write')
          /* TWO ROWS, so the warning starts where the dot does. */
          return (
            <li key={url} className="flex flex-col gap-1 py-3">
              <span className="flex items-center gap-3">
              {/* The dot IS the state. */}
              <span
                role="img"
                aria-label={subscribed ? `Connection ${state}` : 'Not subscribed'}
                title={subscribed ? state : 'Not subscribed, you publish here but do not read'}
                className={`size-2 shrink-0 rounded-full ${
                  !subscribed
                    ? 'bg-border'
                    : state === 'open'
                      ? 'bg-success'
                      : state === 'connecting'
                        ? 'bg-warning'
                        : 'bg-danger'
                }`}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[15px] text-text" title={url}>
                  {/* The whole address, scheme included. */}
                {url}
              </span>
              {/* THE BADGE IS THE CONTROL. */}
              {listed ? (
                <span className="relative shrink-0">
                  <select
                    value={choice}
                    onChange={change => setPolicy(url, change.target.value as RelayPolicyChoice)}
                    aria-label={`What ${url} is used for`}
                    title={POLICY_HELP[choice]}
                    /* No focus ring on this one, and it is the only place that opts out. */
                    className="cursor-pointer appearance-none rounded-full bg-bg-inset py-0.5 pl-2 pr-6 text-xs text-text-muted hover:bg-border focus:outline-none focus-visible:bg-border focus-visible:outline-none"
                  >
                    {/* Ordered by how much damage a mis-selection does, least first. */}
                    {(['both', 'read', 'write'] as const).map(option => (
                      <option key={option} value={option}>
                        {POLICY_LABEL[option]}
                      </option>
                    ))}
                  </select>
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[14px]! text-text-faint"
                  >
                    expand_more
                  </span>
                </span>
              ) : policy === undefined ? null : (
                <span className="shrink-0 rounded-full bg-bg-inset px-2 py-0.5 text-xs text-text-muted">
                  write only
                </span>
              )}
              {/* Icon in a soft red disc rather than the word "Remove". */}
              <button
                type="button"
                onClick={() => remove(url)}
                disabled={!listed || relays.length <= 1}
                aria-label={`Remove ${url}`}
                title="Remove"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-danger-surface text-danger-text transition-colors hover:bg-danger-border disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
                  delete
                </span>
              </button>
              </span>

              {/* THE CONSEQUENCE, ON ITS OWN LINE, STARTING WHERE THE DOT DOES. */}
              {POLICY_EFFECT[choice] === undefined ? null : (
                <span className="flex items-start gap-1.5 text-[13px] text-warning-text">
                  <span className="material-symbols-outlined shrink-0 text-[15px]!" aria-hidden="true">
                    warning
                  </span>
                  <span className="min-w-0">{POLICY_EFFECT[choice]}</span>
                </span>
              )}
            </li>
          )
        })}
      </ul>

      <form
        className="mt-4 flex flex-wrap items-start gap-2"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <span className="min-w-56 flex-1">
          <label htmlFor="add-relay" className="sr-only">
            Add a relay
          </label>
          <input
            id="add-relay"
            value={draft}
            onChange={e => {
              setDraft(e.target.value)
              setError(null)
            }}
            placeholder="wss://relay.example.com"
            className={INPUT_BASE}
          />
          {error !== null ? (
            <span role="alert" className="mt-1 block text-[14px] text-danger-text">
              {error}
            </span>
          ) : null}
        </span>
        {/* A transparent 1px border, so the button's box matches the field's exactly. */}
        <button type="submit" className={`${BUTTON_PRIMARY} border border-transparent`}>
          Add
        </button>
      </form>

      {/* THE TWO LISTS, SIDE BY SIDE, one row of their own. */}
      {/* Each takes half the column, so the pair squares off against the list and the add. */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={reset}
          /* Compared against the actual list rather than the `source` label: choosing. */
          disabled={onDefaults}
          className={`${BUTTON_QUIET} flex-1`}
        >
          {/* Shorter on a phone: two buttons sharing a 430px row wrapped their labels. */}
          <span className="sm:hidden">Nostrich defaults</span>
          <span className="hidden sm:inline">Use Nostrich defaults</span>
        </button>
        <button
          type="button"
          onClick={onRestorePublished}
          disabled={restoring || source === 'imported' || !canRestorePublished}
          className={`${BUTTON_QUIET} flex-1`}
          title={canRestorePublished ? undefined : 'Sign in to use your own published list'}
        >
          {restoring ? (
            'Checking…'
          ) : (
            <>
              <span className="sm:hidden">Use my relays</span>
              <span className="hidden sm:inline">Use my published relays</span>
            </>
          )}
        </button>
      </div>

      {restoreNote === null ? null : (
        <p role="status" className="mt-2 text-[15px] text-text-muted">
          {restoreNote}
        </p>
      )}

      {/* PUBLISHING IS OFFERED, NEVER AUTOMATIC. */}
      {needsPublish ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-inset px-3 py-2.5">
          <span className="min-w-0 flex-1 text-[15px] text-text-muted">
            These changes are saved only on this device. Publish them to use the same relay list across your other clients.
          </span>
          <button type="button" onClick={onPublish} disabled={publishing} className={BUTTON_PRIMARY}>
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      ) : null}

      {/* WARN ONLY WHEN SOMETHING IS ACTUALLY BROKEN. */}
      {broken === null ? null : (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-[15px] text-warning-text"
        >
          <span className="material-symbols-outlined shrink-0 text-[20px]!" aria-hidden="true">
            warning
          </span>
          <span className="min-w-0">{broken}</span>
        </p>
      )}

      {/* WHERE YOUR LIST ACTUALLY. */}
      {health.ready && health.answered > 0 && health.current < health.answered ? (
        <p className="mt-3 rounded-lg border border-border bg-bg-inset px-3 py-2.5 text-[15px] text-text-muted">
          {health.current} of {health.answered} relays have your latest list. The others are
          serving an older copy, publishing again usually settles it.
        </p>
      ) : null}

      {publishNote === null ? null : (
        /* The same box the spread notice uses, in the semantic colour for what happened. */
        <p
          role="status"
          className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[15px] ${
            publishNote.ok
              ? 'border-success-border bg-success-surface text-success-text'
              : 'border-border bg-bg-inset text-text-muted'
          }`}
        >
          {publishNote.ok ? (
            <span className="material-symbols-outlined shrink-0 text-[20px]!" aria-hidden="true">
              check_circle
            </span>
          ) : null}
          <span className="min-w-0">{publishNote.text}</span>
        </p>
      )}
    </section>
  )
}
