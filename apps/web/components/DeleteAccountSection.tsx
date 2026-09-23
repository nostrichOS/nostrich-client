'use client'

import { useState } from 'react'

import { deleteAccount, type DeletionOutcome } from '../lib/delete-account'
import { nativeShellSignOut, useIsNativeShell } from '../lib/native-shell'
import {
  BUTTON_DANGER,
  BUTTON_GHOST,
  INPUT_BASE,
  SETTINGS_BODY,
  SETTINGS_HINT,
  SETTINGS_LABEL,
} from '../lib/styles'
import { sessionPubkey, sessionSigner, useSession } from './SessionProvider'

/** Leaving. */
export function DeleteAccountSection(): React.ReactNode {
  const { session, signOut } = useSession()
  const pubkey = sessionPubkey(session)
  const signer = sessionSigner(session)
  const shell = useIsNativeShell()

  const [asking, setAsking] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<DeletionOutcome | null>(null)

  const armed = typed === 'DELETE'

  // Signed out, or signed in read-only from a pasted npub: no key here to erase.
  if (pubkey === undefined || signer === undefined) return null

  if (done !== null) {
    return (
      <section aria-labelledby="deleted-heading" className="mt-10 border-t border-border pt-6">
        <h2 id="deleted-heading" className={SETTINGS_LABEL}>
          Account deleted
        </h2>
        <p className={`mt-2 max-w-prose ${SETTINGS_BODY}`}>
          Your profile is cleared and this device has forgotten your key. You are signed out.
        </p>
        {/* Only the FAILURES get a line. */}
        {done.profileBlanked && done.serverCleared ? null : (
          <p className={`mt-3 max-w-prose ${SETTINGS_HINT} text-danger-text`}>
            {!done.profileBlanked && !done.serverCleared
              ? 'Your profile could not be cleared, and nostrich.org could not be reached.'
              : done.profileBlanked
                ? 'nostrich.org could not be reached, so your name@nostrich.org handle may still exist.'
                : 'Your profile could not be cleared on the network.'}{' '}
            Your key has been erased from this device, so sign in with your nsec elsewhere to
            finish.
          </p>
        )}
      </section>
    )
  }

  const run = (): void => {
    setBusy(true)
    void deleteAccount(signer, pubkey)
      .then(outcome => {
        setDone(outcome)
        /* Sign out LAST, and tell the app as well as the page. */
        if (shell) nativeShellSignOut(pubkey)
        signOut(pubkey)
      })
      .catch(() => {
        // `deleteAccount` swallows its own step failures, so reaching here means something.
        setBusy(false)
      })
  }

  return (
    <section aria-labelledby="delete-heading" className="mt-10 border-t border-border pt-6">
      <h2 id="delete-heading" className={`flex items-center gap-2 ${SETTINGS_LABEL}`}>
        <span
          className="material-symbols-outlined text-[20px]! text-danger-text"
          aria-hidden="true"
        >
          warning
        </span>
        Danger zone
      </h2>

      <p className={`mt-2 max-w-prose ${SETTINGS_BODY}`}>
        This will permanently delete your Nostr account. Without a backup of your key you will not
        be able to sign in via Nostrich or any other Nostr app.
      </p>

      {asking ? (
        <>
          <label htmlFor="delete-confirm" className={`mt-5 block ${SETTINGS_LABEL}`}>
            Type DELETE to confirm
          </label>
          {/* `items-stretch`, so the buttons are exactly as tall as the field. */}
          <div className="mt-2 flex flex-wrap items-stretch gap-2">
            <input
              id="delete-confirm"
              value={typed}
              onChange={event => setTyped(event.target.value)}
              disabled={busy}
              placeholder="DELETE"
              /* No autocorrect and no capitalisation help. */
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              /* Focused on reveal, so the field the press just summoned is the one the cursor. */
              autoFocus
              /* NO RING. The field's OWN border does the job. */
              className={`${INPUT_BASE} max-w-40 focus-visible:outline-none! focus-visible:border-danger-text`}
            />
            <button type="button" disabled={!armed || busy} onClick={run} className={BUTTON_DANGER}>
              <TrashIcon />
              {busy ? 'Deleting…' : 'Delete account'}
            </button>
            {/* A way back out. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAsking(false)
                setTyped('')
              }}
              className={BUTTON_GHOST}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className={`${BUTTON_DANGER} mt-4`}>
          <TrashIcon />
          Delete account
        </button>
      )}
    </section>
  )
}

/** The trash bin, in front of the words. */
function TrashIcon(): React.ReactNode {
  return (
    <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
      delete
    </span>
  )
}
