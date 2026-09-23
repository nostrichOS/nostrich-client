'use client'

import { Link } from './AppLink'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  DEFAULT_SIGNER_RELAYS,
  DEFAULT_RELAYS,
  Nip07Signer,
  Nip46Signer,
  PrivateKeySigner,
  createNostrConnectInvite,
  derivePublicKey,
  encodeNpub,
  encodeNsec,
  encryptToNcryptsec,
  generateKeyPair,
  isNip07Available,
  parseKeyInput,
  profileDisplayName,
  type Hex,
  type NostrConnectInvite,
  type RelayUrl,
} from '@nostrich/nostr'

import type { StoredSession } from '@nostrich/types'

import { clearPendingConnect, readPendingConnect, writePendingConnect } from '../lib/pending-connect'
import { displayKey } from '../lib/format'
import { patientSigner } from '../lib/patient-signer'
import { askToApprove } from '../lib/signer-approval'
import { SIGNER_PERMS } from '../lib/signer-perms'
import { useProfile } from '../lib/profiles'
import { BUTTON_PRIMARY, BUTTON_QUIET, INPUT_BASE, LINK } from '../lib/styles'
import { ContentLink } from './ContentLink'
import { Avatar } from './Avatar'
import { QrCode } from './QrCode'
import { MAX_ACCOUNTS, sessionPubkey, useSession } from './SessionProvider'

/** The five ways. */

type TabId = 'new' | 'extension' | 'remote' | 'nsec'

const TABS: { id: TabId; label: string }[] = [
  { id: 'new', label: 'New key' },
  { id: 'extension', label: 'Extension' },
  { id: 'remote', label: 'Remote signer' },
  { id: 'nsec', label: 'Private key' },
]

/** Throws when the reader is already at the account limit. */
function assertAdopted(added: boolean): void {
  if (!added) {
    throw new Error(
      `You can be signed in to ${MAX_ACCOUNTS} accounts at once. Sign out of one before adding another.`,
    )
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'That did not work. Check the value and try again.'
}

/** Extensions inject window.nostr after our bundle evaluates, so one check is a coin. */
function useExtensionAvailable(): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (isNip07Available()) {
      setAvailable(true)
      return
    }
    const timers = [400, 1200].map(delay =>
      setTimeout(() => {
        if (isNip07Available()) setAvailable(true)
      }, delay),
    )
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [])

  return available
}

export function SignInPanel({ onDone }: { onDone: () => void }): React.ReactNode {
  const { session, adopt, signOut, locked, unlock } = useSession()
  const [tab, setTab] = useState<TabId>('new')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const currentPubkey = sessionPubkey(session)

  const finish = useCallback((): void => {
    setBusy(false)
    onDone()
  }, [onDone])

  const fail = useCallback((cause: unknown): void => {
    setError(messageOf(cause))
    setNotice(null)
    setBusy(false)
  }, [])

  // Cleared on every tab change: an error about a bad nsec makes no sense sitting.
  const select = (next: TabId): void => {
    setTab(next)
    setError(null)
    setNotice(null)
  }

  const shared = { busy, setBusy, setError, setNotice, adopt, finish, fail }

  return (
    <div className="space-y-5">
      {currentPubkey !== undefined ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
          <p className="text-sm text-text-muted">
            Signed in as <span className="font-mono text-text">{displayKey(currentPubkey)}</span>
          </p>
          {/* Wrapped, not passed by reference: signOut takes an optional pubkey, and handing. */}
          <button type="button" onClick={() => signOut()} className={BUTTON_QUIET}>
            Sign out
          </button>
        </div>
      ) : null}

      {/* Offered before the tabs. */}
      {locked.map(item => (
        <UnlockRow
          key={item.pubkey}
          pubkey={item.pubkey}
          onUnlock={passphrase => {
            unlock(item.pubkey, passphrase)
            onDone()
          }}
        />
      ))}

      <div
        role="tablist"
        aria-label="Sign-in method"
        // justify-between with content-sized tabs, not equal flex-1 cells.
        className="no-scrollbar flex justify-between gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map(item => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            onClick={() => select(item.id)}
            className="relative flex shrink-0 cursor-pointer justify-center whitespace-nowrap rounded-t-lg px-2 py-3 text-[13px] transition-colors hover:bg-bg-inset sm:text-[15px]"
          >
            <span className="relative">
              <span className={tab === item.id ? 'font-bold text-text' : 'font-medium text-text-muted'}>
                {item.label}
              </span>
              {/* Sits under the LABEL and takes its width, rather than a fixed w-12 centred. */}
              {tab === item.id ? (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-3 left-0 right-0 h-1 rounded-lg bg-text"
                />
              ) : null}
            </span>
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'new' ? <NewKeyTab {...shared} /> : null}
        {tab === 'extension' ? <ExtensionTab {...shared} /> : null}
        {tab === 'remote' ? <RemoteTab {...shared} /> : null}
        {tab === 'nsec' ? <NsecTab {...shared} /> : null}
      </div>

      <div aria-live="polite" className="space-y-3 empty:hidden">
        {notice !== null ? <p className="text-sm text-text-muted">{notice}</p> : null}
      </div>

      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-text"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** One saved, still-encrypted account waiting for its passphrase. */
function UnlockRow({
  pubkey,
  onUnlock,
}: {
  pubkey: Hex
  onUnlock: (passphrase: string) => void
}): React.ReactNode {
  const profile = useProfile(pubkey)
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const name = profileDisplayName(profile ?? { pubkey })

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (passphrase === '') return
    try {
      onUnlock(passphrase)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not unlock it.')
      setPassphrase('')
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-bg-elevated p-4">
      <div className="flex items-center gap-3">
        <Avatar pubkey={pubkey} name={name} picture={profile?.picture} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-text">{name}</p>
          <p className="text-xs text-text-faint">Saved on this device. Enter your password.</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <input
          type="password"
          value={passphrase}
          onChange={event => setPassphrase(event.target.value)}
          autoComplete="current-password"
          aria-label={`Password for ${name}`}
          placeholder="Password"
          className={INPUT_BASE}
        />
        <button type="submit" disabled={passphrase === ''} className={`${BUTTON_PRIMARY} shrink-0 disabled:opacity-40`}>
          Unlock
        </button>
      </div>
      {error !== null ? (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {error}
        </p>
      ) : null}
    </form>
  )
}

interface TabProps {
  busy: boolean
  setBusy: (value: boolean) => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  adopt: ReturnType<typeof useSession>['adopt']
  finish: () => void
  fail: (cause: unknown) => void
}

// ---------------------------------------------------------------------------.

/** Making a Nostr identity, for someone who does not have one. */
function NewKeyTab({ busy, setBusy, setError, adopt, finish, fail }: TabProps): React.ReactNode {
  const [pair, setPair] = useState<{ secretKey: Uint8Array; nsec: string; npub: string } | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [copied, setCopied] = useState<'nsec' | 'npub' | null>(null)
  const [working, setWorking] = useState(false)
  const passId = useId()

  // Zero the bytes when the reader navigates away.
  const pairRef = useRef(pair)
  pairRef.current = pair
  useEffect(
    () => () => {
      pairRef.current?.secretKey.fill(0)
    },
    [],
  )

  useEffect(() => {
    if (copied === null) return
    const timer = setTimeout(() => setCopied(null), 2_000)
    return () => clearTimeout(timer)
  }, [copied])

  const generate = (): void => {
    setError(null)
    const { secretKey, publicKey } = generateKeyPair()
    setPair({ secretKey, nsec: encodeNsec(secretKey), npub: encodeNpub(publicKey) })
    setRevealed(false)
    setSaved(false)
  }

  const copy = async (value: string, which: 'nsec' | 'npub'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
    } catch {
      setError('Could not copy. Select the text and copy it manually.')
    }
  }

  /** Hand a file to the browser. */
  const download = (contents: string, filename: string): void => {
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const downloadEncrypted = (): void => {
    if (pair === null) return
    if (passphrase.length < 8) {
      setError('Use a passphrase of at least 8 characters for the encrypted backup.')
      return
    }
    setError(null)
    setWorking(true)
    // Deferred a frame: scrypt at 2^16 blocks the main thread for about a second.
    setTimeout(() => {
      try {
        const ncryptsec = encryptToNcryptsec(pair.secretKey, passphrase)
        download(
          `${ncryptsec}\n`,
          `nostrich-${pair.npub.slice(0, 12)}.ncryptsec.txt`,
        )
      } catch (cause) {
        setError(messageOf(cause))
      } finally {
        setWorking(false)
      }
    }, 0)
  }

  const start = (): void => {
    if (pair === null || !saved) return
    setBusy(true)
    setError(null)
    try {
      const signer = PrivateKeySigner.fromSecretKey(pair.secretKey)
      /** THE KEY IS HANDED OVER TO BE WRITTEN DOWN, exactly as the paste-an-nsec path does. */
      assertAdopted(
        adopt({ status: 'signed', pubkey: derivePublicKey(pair.secretKey), signer }, { nsec: pair.nsec }),
      )
      pair.secretKey.fill(0)
      setPair(null)
      finish()
    } catch (cause) {
      fail(cause)
    }
  }

  if (pair === null) {
    return (
      <div>
        {/* Explains what Nostr IS before asking for anything, because this is the one tab. */}
        <p className="max-w-prose text-[15px] leading-relaxed text-text-muted">
          A Nostr private key is created instantly on your device. It gives you full control of
          your identity and works across Nostr apps. No email, password, or signup required.
        </p>

        <div className="mt-5 rounded-lg border border-border bg-bg-elevated px-6 py-7 text-center">
          <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-lg border border-border-strong bg-bg text-text-muted">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="15" r="4" />
              <path d="m10.8 12.2 8-8M17 5l2 2M14 8l2 2" />
            </svg>
          </span>
          <h3 className="text-lg font-bold tracking-tight text-text">Create your Nostr identity</h3>
          {/* One line, and sized so it stays one. */}
          <p className="mx-auto mt-1.5 whitespace-nowrap text-[13.5px] leading-relaxed text-text-muted max-[374px]:whitespace-normal">
            No signup. No account. Just a keypair you control.
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className={`${BUTTON_PRIMARY} mt-5 w-full max-w-[330px]`}
          >
            Generate a new key
          </button>
        </div>

        {/* The two halves named plainly, plus the fact that makes Nostr different. */}
        <dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          {[
            { term: 'npub', detail: 'Your public key. This is how others follow you.' },
            { term: 'nsec', detail: 'Your secret private key. It signs your posts.' },
            { term: 'Portable', detail: 'Works in every Nostr app, not just Nostrich.' },
          ].map(fact => (
            <div key={fact.term} className="bg-bg px-4 py-3.5">
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-faint">
                {fact.term}
              </dt>
              <dd className="mt-1 text-[13.5px] leading-snug text-text-muted">{fact.detail}</dd>
            </div>
          ))}
        </dl>

        {/* Collapsed by default. */}
        <details className="group mt-5 border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-text-muted hover:text-text [&::-webkit-details-marker]:hidden">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform group-open:rotate-45"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            How does an account with no password work?
          </summary>
          <dl className="mt-3 grid gap-4">
            {[
              {
                term: 'The pair',
                detail:
                  'Your identity is a single keypair. Your public key is what others follow. Your private key proves a post came from you.',
              },
              {
                term: 'No recovery',
                detail:
                  'Nobody stores your private key, so nobody can reset or recover it. Keep a secure backup.',
              },
              {
                term: 'One key, many apps',
                detail:
                  'Your key works across Nostr apps. Nostrich is one way to access the network, not the network itself.',
              },
            ].map(item => (
              <div key={item.term}>
                <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-faint">
                  {item.term}
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-text-muted">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Field label="Your public key" hint="Safe to share. This is what people follow.">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-bg-inset px-3 py-2 font-mono text-xs text-text-muted">
            {pair.npub}
          </code>
          <button type="button" onClick={() => void copy(pair.npub, 'npub')} className={`${BUTTON_QUIET} shrink-0`}>
            {copied === 'npub' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </Field>

      <Field label="Your private key" hint="Never share this with anyone, ever.">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-bg-inset px-3 py-2 font-mono text-xs text-text-muted">
            {/* Hidden until asked. */}
            {revealed ? pair.nsec : '•'.repeat(38)}
          </code>
          <button type="button" onClick={() => setRevealed(!revealed)} className={`${BUTTON_QUIET} shrink-0`}>
            {revealed ? 'Hide' : 'Reveal'}
          </button>
          <button
            type="button"
            onClick={() => void copy(pair.nsec, 'nsec')}
            className={`${BUTTON_QUIET} shrink-0`}
          >
            {copied === 'nsec' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </Field>

      <div className="space-y-3 rounded-lg border border-border bg-bg-elevated p-4">
        <p className="text-sm font-semibold text-text">Download a backup</p>
        <label htmlFor={passId} className="block text-xs text-text-faint">
          Encrypted backup (recommended). Choose a passphrase you will not forget, because there
          is no way to recover it either. The file works in any Nostr app that supports NIP-49.
        </label>
        <div className="flex items-center gap-2">
          <input
            id={passId}
            type="password"
            value={passphrase}
            onChange={event => setPassphrase(event.target.value)}
            autoComplete="new-password"
            placeholder="Passphrase"
            className={INPUT_BASE}
          />
          <button
            type="button"
            onClick={downloadEncrypted}
            disabled={working || passphrase.length < 8}
            className={`${BUTTON_PRIMARY} shrink-0 disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {working ? 'Encrypting…' : 'Download'}
          </button>
        </div>

        <p className="border-t border-border pt-3 text-xs text-text-faint">
          Or{' '}
          <button
            type="button"
            onClick={() => download(`${pair.nsec}\n`, `nostrich-${pair.npub.slice(0, 12)}-SECRET.txt`)}
            className={LINK}
          >
            download it unencrypted
          </button>
          . Quicker, but it saves a plain private key into your Downloads folder, which on many
          machines syncs to iCloud or OneDrive within seconds. Move it into a password manager
          and delete the file.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 text-sm text-text">
        <input
          type="checkbox"
          checked={saved}
          onChange={event => setSaved(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[#f97315]"
        />
        <span>
          I have saved my private key somewhere safe. I understand that nobody can recover it for
          me, and that losing it means losing this account permanently.
        </span>
      </label>

      <button
        type="button"
        onClick={start}
        disabled={!saved || busy}
        className={`${BUTTON_PRIMARY} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {busy ? 'Working…' : 'Start using Nostrich'}
      </button>
    </div>
  )
}

/** Label, hint and control, so the three blocks on the new-key screen line up. */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <div>
      <p className="text-sm font-semibold text-text">{label}</p>
      <p className="mb-2 text-xs text-text-faint">{hint}</p>
      {children}
    </div>
  )
}

/** How long the extension gets before this screen says something. */
const EXTENSION_DEADLINE_MS = 12_000

function ExtensionTab({ busy, setBusy, setError, setNotice, adopt, finish, fail }: TabProps): React.ReactNode {
  const available = useExtensionAvailable()

  const go = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice('Waiting for the extension to approve…')
    /* A DEADLINE, because an extension's promise is allowed to never settle and ours. */
    let settled = false
    const signer = new Nip07Signer()
    const deadline = setTimeout(() => {
      if (settled) return
      setBusy(false)
      setNotice(null)
      setError(
        'The extension has not answered. Click its toolbar icon, an approval window may be ' +
          'waiting, or the wallet may be locked, then try again.',
      )
    }, EXTENSION_DEADLINE_MS)
    try {
      const pubkey = await signer.getPublicKey()
      settled = true
      clearTimeout(deadline)
      assertAdopted(adopt({ status: 'signed', pubkey, signer }))
      finish()
    } catch (cause) {
      settled = true
      clearTimeout(deadline)
      fail(cause)
    }
  }

  return (
    <div className="space-y-3">
      <Info tone="good">
        The safest option on desktop. A NIP-07 extension like Alby or nos2x keeps your private
        key and signs for you. Your key never enters Nostrich, and you stay signed in through the
        extension.
      </Info>
      <button type="button" onClick={() => void go()} disabled={busy} className={BUTTON_PRIMARY}>
        Continue with extension
      </button>
      {!available ? (
        <p className="text-xs text-text-faint">
          No NIP-07 extension detected in this browser yet. Install one, or use another tab.
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------.

/** NIP-46, in both directions. */
/** What to write down after a remote signer accepts us. */
function pairingToKeep(
  signer: Nip46Signer,
  pubkey: Hex,
): { nip46: Extract<StoredSession, { kind: 'nip46' }> } | undefined {
  const credential = signer.toResumable()
  if (credential === undefined) return undefined
  return {
    nip46: {
      kind: 'nip46',
      pubkey,
      clientSecretKey: credential.clientSecretKey,
      remoteSignerPubkey: credential.remoteSignerPubkey,
      relays: credential.relays,
      perms: credential.perms,
    },
  }
}

function RemoteTab({ busy, setBusy, setError, setNotice, adopt, finish, fail }: TabProps): React.ReactNode {
  const [invite, setInvite] = useState<NostrConnectInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [uri, setUri] = useState('')
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const fieldId = useId()
  const inviteRef = useRef<NostrConnectInvite | null>(null)

  /** Where an approval prompt goes, before and after this panel has done its job. */
  const handedOff = useRef(false)
  const handleAuthUrl = useCallback((url: string): void => {
    if (handedOff.current) askToApprove(url)
    else setAuthUrl(url)
  }, [])

  /** ONE INVITE, AND IT SURVIVES THE APP BEING KILLED. */
  useEffect(() => {
    let live = true
    let created: NostrConnectInvite | null = null

    const start = (): NostrConnectInvite | null => {
      const held = readPendingConnect()
      try {
        return createNostrConnectInvite({
          /* `DEFAULT_SIGNER_RELAYS`, not the first three read relays. */
          relays: held === undefined ? [...DEFAULT_SIGNER_RELAYS] : (held.relays as RelayUrl[]),
          name: 'Nostrich',
          url: 'https://nostrich.org',
          perms: SIGNER_PERMS,
          onAuthUrl: handleAuthUrl,
          ...(held === undefined
            ? {}
            : {
                resume: {
                  clientSecretKey: held.clientSecretKey,
                  secret: held.secret,
                  since: held.createdAt,
                },
              }),
        })
      } catch {
        // No relays configured.
        return null
      }
    }

    const listen = (invite: NostrConnectInvite): void => {
      invite
        .waitForSigner()
        .then(raw => {
          if (!live) return
          /* Same wrapper as every other path: a slow signature says so instead of looking. */
          const signer = patientSigner(raw)
          return signer.getPublicKey().then(pubkey => {
            // Paired.
            clearPendingConnect()
            handedOff.current = true
            assertAdopted(adopt({ status: 'signed', pubkey, signer }, pairingToKeep(signer, pubkey)))
            finish()
          })
        })
        .catch(() => {
          // Timeout or cancellation.
        })
    }

    created = start()
    if (created === null) return
    writePendingConnect({
      clientSecretKey: created.clientSecretKey,
      secret: created.secret,
      relays: [...DEFAULT_SIGNER_RELAYS],
      createdAt: created.createdAt,
    })
    inviteRef.current = created
    setInvite(created)
    listen(created)

    /** COMING BACK IS THE MOMENT THAT MATTERS, so rebuild the listener. */
    const onVisible = (): void => {
      if (!live || document.visibilityState !== 'visible') return
      if (readPendingConnect() === undefined) return
      created?.cancel()
      const resumed = start()
      if (resumed === null) return
      created = resumed
      inviteRef.current = resumed
      setInvite(resumed)
      listen(resumed)
    }
    document.addEventListener('visibilitychange', onVisible)
    // Safari fires `pageshow` on a back-forward-cache restore without a visibility change.
    window.addEventListener('pageshow', onVisible)

    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
      /* Cancelled, but the RECORD is deliberately kept. */
      created?.cancel()
      inviteRef.current = null
    }
  }, [adopt, finish])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2_000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async (): Promise<void> => {
    if (invite === null) return
    try {
      await navigator.clipboard.writeText(invite.uri)
      setCopied(true)
    } catch {
      setError('Could not copy. Select the text and copy it manually.')
    }
  }

  const submitBunker = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const input = uri.trim()
    if (input === '' || busy) return
    setBusy(true)
    setError(null)
    setNotice('Connecting to your remote signer…')
    try {
      const signer = patientSigner(Nip46Signer.fromBunkerUri(input, {
        // A bunker that wants browser approval says so exactly.
        onAuthUrl: handleAuthUrl,
        perms: SIGNER_PERMS,
      }))
      const pubkey = await signer.connect()
      setNotice(null)
      handedOff.current = true
      assertAdopted(adopt({ status: 'signed', pubkey, signer }, pairingToKeep(signer, pubkey)))
      finish()
    } catch (cause) {
      fail(cause)
    }
  }

  return (
    <div className="space-y-4">
      <Info tone="good">
        Your private key stays with your own remote signer, such as Amber on your phone or a
        self-hosted bunker. Nostrich only sends signing requests and never sees or stores your
        key. Scan the QR code with your signer, or paste its{' '}
        <code className="font-mono">bunker://</code> URI below.
      </Info>

      {invite !== null ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-bg-elevated p-4">
          <QrCode value={invite.uri} label="Scan with your remote signer app" />
          <p className="text-xs text-text-faint">Waiting for a signer to scan this…</p>

          {/* The URI in full, selectable, plus a copy button. */}
          <div className="flex w-full items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-bg-inset px-3 py-2 font-mono text-xs text-text-muted">
              {invite.uri}
            </code>
            <button type="button" onClick={() => void copy()} className={`${BUTTON_QUIET} shrink-0`}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={event => void submitBunker(event)} className="space-y-3 border-t border-border pt-4">
        <label htmlFor={fieldId} className="block text-sm font-semibold text-text">
          Or paste a bunker URI
        </label>
        <input
          id={fieldId}
          value={uri}
          onChange={event => setUri(event.target.value)}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          placeholder="bunker://…"
          className={`${INPUT_BASE} font-mono`}
        />
        <button type="submit" disabled={busy || uri.trim() === ''} className={BUTTON_PRIMARY}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>

      {authUrl !== null ? (
        <p className="rounded-lg border border-accent-border bg-accent-subtle px-3 py-2 text-sm text-text">
          Your signer needs approval.{' '}
          <ContentLink href={authUrl} className={LINK}>
            Open the approval page
          </ContentLink>
          , then come back here.
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------.

function NsecTab({ busy, setBusy, setError, adopt, finish, fail }: TabProps): React.ReactNode {
  const [value, setValue] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const fieldId = useId()
  const passId = useId()

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const input = value.trim()
    if (input === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      const parsed = parseKeyInput(input)
      if (parsed.kind !== 'privatekey') {
        throw new Error('That is not an nsec. It should start with nsec1.')
      }
      // Clear the field before anything can re-render with an nsec still.
      setValue('')
      try {
        const signer = PrivateKeySigner.fromSecretKey(parsed.secretKey)
        /* Encrypted when a password was given, plain. */
        const chosen = passphrase.trim()
        const keep =
          chosen === ''
            ? { nsec: encodeNsec(parsed.secretKey) }
            : { ncryptsec: encryptToNcryptsec(parsed.secretKey, chosen) }
        setPassphrase('')
        assertAdopted(adopt({ status: 'signed', pubkey: parsed.publicKey, signer }, keep))
      } finally {
        // The signer copied the bytes.
        parsed.secretKey.fill(0)
      }
      finish()
    } catch (cause) {
      fail(cause)
    }
  }

  return (
    <div className="space-y-4">
      {/* Headline only. */}
      <Info tone="danger" title="This is the least secure way to sign in" />

      {/* WHAT ACTUALLY HAPPENS TO THE KEY. */}
      <Info tone="neutral" title="How it works">
        Your private key is saved only in your browser, so you can stay signed in. If you set a
        password, it&rsquo;s stored encrypted for added security. Your key is never sent to
        Nostrich, and all signing happens locally on your device.
      </Info>

      <form onSubmit={event => void submit(event)} className="space-y-3">
        <label htmlFor={fieldId} className="block text-sm font-semibold text-text">
          Private key
        </label>
        <input
          id={fieldId}
          // Masked.
          type="password"
          value={value}
          onChange={event => setValue(event.target.value)}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          placeholder="nsec1…"
          className={`${INPUT_BASE} font-mono`}
        />
        <div>
          <label htmlFor={passId} className="block text-sm font-semibold text-text">
            Encrypt your key with a password{' '}
            <span className="font-normal text-text-faint">(optional)</span>
          </label>
          <p className="mb-2 text-xs text-text-faint">
            Recommended. Without one your key is kept in your browser unencrypted.
          </p>
          <input
            id={passId}
            type="password"
            value={passphrase}
            onChange={event => setPassphrase(event.target.value)}
            disabled={busy}
            autoComplete="new-password"
            className={INPUT_BASE}
          />
        </div>

        <button type="submit" disabled={busy || value.trim() === ''} className={BUTTON_PRIMARY}>
          {busy ? 'Working…' : 'Sign in with private key'}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------.

/** The coloured explanation boxes. */
function Info({
  tone,
  title,
  children,
}: {
  tone: 'danger' | 'neutral' | 'good'
  title?: string
  /** Optional: a box can be a single headline with nothing. */
  children?: React.ReactNode
}): React.ReactNode {
  const skin =
    tone === 'danger'
      ? 'border-danger-border bg-danger-surface text-danger-text'
      : tone === 'good'
        ? 'border-border bg-bg-elevated text-text-muted'
        : 'border-border bg-bg-inset text-text-muted'
  const icon = tone === 'danger' ? 'warning' : tone === 'good' ? 'verified_user' : 'info'

  return (
    <div className={`flex gap-3 rounded-lg border px-4 py-3 ${skin}`}>
      <span className="material-symbols-outlined shrink-0 text-[20px]!" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 text-sm leading-relaxed">
        {/* No bottom margin when the title is the whole box, or it sits off-centre. */}
        {title !== undefined ? (
          <p
            className={`font-semibold ${children === undefined ? '' : 'mb-1'} ${
              tone === 'danger' ? '' : 'text-text'
            }`}
          >
            {title}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  )
}
