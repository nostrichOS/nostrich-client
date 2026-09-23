'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  signerRelays,
  Nip07Signer,
  Nip46Signer,
  PrivateKeySigner,
  decryptNcryptsec,
  type Hex,
  type Signer,
} from '@nostrich/nostr'
import type { StoredSession } from '@nostrich/types'

import { deleteLegacyVault } from '../lib/legacy-vault'
import { readStoredAccounts, writeStoredAccounts, clearStoredAccounts } from '../lib/session-storage'
import { patientSigner } from '../lib/patient-signer'
import { askToApprove } from '../lib/signer-approval'
import { setActiveScope } from '../lib/scope'

/** `useLayoutEffect` warns when it runs on the server, where there is nothing to lay. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export type Session =
  | { status: 'anonymous' }
  | { status: 'readonly'; pubkey: Hex }
  | { status: 'signed'; pubkey: Hex; signer: Signer }

/** A session the reader can switch back to without signing in again. */
export interface Account {
  pubkey: Hex
  /** Present when the reader chose a password: the encrypted form, and what gets stored. */
  ncryptsec?: string
  /** Present when they did not: the key as-is. */
  nsec?: string
  /** Present for a remote-signer account: the transport pairing, so it can be rebuilt. */
  nip46?: Extract<StoredSession, { kind: 'nip46' }>
  session: Exclude<Session, { status: 'anonymous' }>
  /** False only for a session that genuinely cannot outlive this tab. */
  persistent: boolean
}

interface SessionContextValue {
  session: Session
  /** Every signed-in account, active one included. */
  accounts: Account[]
  /** False until stored accounts have been read. */
  ready: boolean
  /** Add or replace an account and bring it to the front. */
  adopt: (
    session: Session,
    keep?: {
      ncryptsec?: string
      nsec?: string
      nip46?: Extract<StoredSession, { kind: 'nip46' }>
      /** Replace the whole list with this account. */
      sole?: boolean
    },
  ) => boolean
  /** Bring an already-added account to the front. */
  switchTo: (pubkey: Hex) => void
  /** Sign out of one account. */
  signOut: (pubkey?: Hex) => void
  /** Sign out of everything. */
  signOutAll: () => void
  /** Accounts restored from storage that are still encrypted. */
  locked: { pubkey: Hex; ncryptsec: string }[]
  /** Decrypt a locked account and bring it to the front. */
  unlock: (pubkey: Hex, passphrase: string) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

const ANONYMOUS: Session = { status: 'anonymous' }
const NO_ACCOUNTS: Account[] = []

/** How many accounts can be signed. */
export const MAX_ACCOUNTS = 5

/** How an account should be written down, or null when it must. */
/* Exported for its test. */
export function persistableForm(account: Account): StoredSession | null {
  const { session } = account
  if (session.status === 'readonly') return { kind: 'readonly', pubkey: session.pubkey }
  if (session.signer.kind === 'nip07') return { kind: 'nip07', pubkey: session.pubkey }
  if (session.signer.kind === 'privatekey') {
    // Encrypted when the reader set a password, plain when they did.
    if (account.ncryptsec !== undefined) {
      return { kind: 'ncryptsec', pubkey: session.pubkey, ncryptsec: account.ncryptsec }
    }
    // Taken from the map the sign-in form filled, never from the signer: the signer.
    return account.nsec === undefined
      ? null
      : { kind: 'privatekey', pubkey: session.pubkey, nsec: account.nsec }
  }
  if (session.signer.kind === 'nip46') {
    // Taken from the record the sign-in form captured, never from the signer.
    return account.nip46 ?? null
  }
  return null
}

/** `saidGoodbye` sends NIP-46 `logout` before closing, and ONLY the sign-out paths. */
function disposeSigner(session: Session, saidGoodbye = false): void {
  if (session.status !== 'signed') return
  // Zero the key / drop the bunker socket rather than waiting for GC.
  const { signer } = session
  if (signer instanceof PrivateKeySigner) signer.dispose()
  else if (signer instanceof Nip46Signer) {
    // Never awaited: the spec calls logout a courtesy hint and requires the client.
    if (saidGoodbye) void signer.logout().catch(() => {})
    else signer.close()
  }
}

/** True when some OTHER account holds the same signer object. */
function isShared(account: Account, within: readonly Account[]): boolean {
  if (account.session.status !== 'signed') return false
  const { signer } = account.session
  return within.some(
    other =>
      other.pubkey !== account.pubkey &&
      other.session.status === 'signed' &&
      other.session.signer === signer,
  )
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [accounts, setAccounts] = useState<Account[]>(NO_ACCOUNTS)
  const [activePubkey, setActivePubkey] = useState<Hex | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [locked, setLocked] = useState<{ pubkey: Hex; ncryptsec: string }[]>([])
  /** Locked accounts, readable by `persist`. */
  const lockedRef = useRef<{ pubkey: Hex; ncryptsec: string }[]>([])
  const rememberLocked = useCallback(
    (next: { pubkey: Hex; ncryptsec: string }[]) => {
      lockedRef.current = next
      setLocked(next)
    },
    [],
  )

  /** Mutators read through these so a call immediately after another sees the new values. */
  const ref = useRef<Account[]>(NO_ACCOUNTS)
  const activeRef = useRef<Hex | undefined>(undefined)

  const persist = useCallback((next: readonly Account[], active: Hex | undefined) => {
    const stored = [
      ...next.map(account => persistableForm(account)).filter((e): e is StoredSession => e !== null),
      // Still-locked accounts must survive every save, or a routine commit deletes.
      ...lockedRef.current.map(
        (item): StoredSession => ({ kind: 'ncryptsec', pubkey: item.pubkey, ncryptsec: item.ncryptsec }),
      ),
    ]
    /** Clear only when the reader genuinely has nothing signed. */
    if (next.length === 0 && lockedRef.current.length === 0) {
      clearStoredAccounts()
      return
    }
    // Signed in, but with nothing worth writing down.
    if (stored.length === 0) return
    // Only name an active account that survives the reload, or the next load would.
    const activeSurvives = stored.some(entry => entry.pubkey === active)
    writeStoredAccounts({ accounts: stored, ...(activeSurvives ? { active } : {}) })
  }, [])

  const commit = useCallback(
    (next: Account[], active: Hex | undefined) => {
      ref.current = next
      activeRef.current = active
      setAccounts(next)
      setActivePubkey(active)
      persist(next, active)
    },
    [persist],
  )

  useEffect(() => {
    // Unconditional, every load, signed.
    deleteLegacyVault()

    const stored = readStoredAccounts()
    // Encrypted accounts are held aside: they exist, they are named on the sign-in.
    const lockedEntries = stored.accounts
      .filter((entry): entry is Extract<StoredSession, { kind: 'ncryptsec' }> => entry.kind === 'ncryptsec')
      .map(entry => ({ pubkey: entry.pubkey, ncryptsec: entry.ncryptsec }))
    lockedRef.current = lockedEntries
    setLocked(lockedEntries)
    const restored: Account[] = []
    for (const entry of stored.accounts) {
      // Encrypted accounts were pulled out above.
      if (entry.kind === 'ncryptsec') continue

      if (entry.kind === 'readonly') {
        restored.push({
          pubkey: entry.pubkey,
          session: { status: 'readonly', pubkey: entry.pubkey },
          persistent: true,
        })
        continue
      }

      if (entry.kind === 'nip07') {
        restored.push({
          pubkey: entry.pubkey,
          // Not downgraded to read-only when window.nostr is missing: extensions inject.
          session: { status: 'signed', pubkey: entry.pubkey, signer: new Nip07Signer() },
          persistent: true,
        })
        continue
      }

      if (entry.kind === 'nip46') {
        /** A remote-signer pairing, rebuilt from the stored transport key. */
        try {
          restored.push({
            pubkey: entry.pubkey,
            nip46: entry,
            session: {
              status: 'signed',
              pubkey: entry.pubkey,
              /* Wrapped so a slow signature explains itself. */
              signer: patientSigner(
                Nip46Signer.fromResumable({
                clientSecretKey: entry.clientSecretKey,
                remoteSignerPubkey: entry.remoteSignerPubkey,
                // Repaired, not trusted as stored: pairings made before the signer relay set existed.
                relays: signerRelays(entry.relays),
                perms: entry.perms ?? [],
              }, {
                /* A restored signer was built without this, and it is the whole reason a bunker could. */
                onAuthUrl: askToApprove,
                /* We already know. */
                userPubkey: entry.pubkey,
              }),
              ),
            },
            persistent: true,
          })
        } catch {
          // Not a usable transport key.
        }
        continue
      }

      // Stored nsec.
      try {
        restored.push({
          pubkey: entry.pubkey,
          nsec: entry.nsec,
          session: {
            status: 'signed',
            pubkey: entry.pubkey,
            signer: PrivateKeySigner.fromNsec(entry.nsec),
          },
          persistent: true,
        })
      } catch {
        // Not a usable key.
      }
    }

    /** Two different situations, and conflating them signed people out of accounts. */
    const active =
      stored.active === undefined
        ? restored[0]?.pubkey
        : restored.find(account => account.pubkey === stored.active)?.pubkey
    ref.current = restored
    activeRef.current = active
    setAccounts(restored)
    setActivePubkey(active)
    setReady(true)
  }, [])

  /** Nudge every remote signer awake when the tab comes back or the network returns. */
  useEffect(() => {
    /* Hidden is not "do nothing". */
    const nudge = (): void => {
      const hidden = document.visibilityState === 'hidden'
      for (const account of ref.current) {
        const { session } = account
        if (session.status !== 'signed') continue
        if (!(session.signer instanceof Nip46Signer)) continue
        if (hidden) session.signer.sleep()
        else session.signer.wake()
      }
    }
    document.addEventListener('visibilitychange', nudge)
    window.addEventListener('online', nudge)
    return () => {
      document.removeEventListener('visibilitychange', nudge)
      window.removeEventListener('online', nudge)
    }
  }, [])

  const adopt = useCallback(
    (
      next: Session,
      keep?: {
        ncryptsec?: string
        nsec?: string
        /** The remote-signer pairing, captured at sign-in so the session can be rebuilt later. */
        nip46?: Extract<StoredSession, { kind: 'nip46' }>
        /** This account REPLACES the list rather than joining. */
        sole?: boolean
      },
    ): boolean => {
      if (next.status === 'anonymous') return false
      const existing = ref.current.find(a => a.pubkey === next.pubkey)
      // Not consulted when replacing: `sole` cannot grow the list, so a full one.
      if (keep?.sole !== true && existing === undefined && ref.current.length >= MAX_ACCOUNTS) {
        return false
      }
      // Re-adopting an account that is already listed keeps whatever it was stored.
      const keptCipher = keep?.ncryptsec ?? existing?.ncryptsec
      const keptPlain = keptCipher !== undefined ? undefined : (keep?.nsec ?? existing?.nsec)
      const keptPairing = keep?.nip46 ?? existing?.nip46
      const account: Account = {
        pubkey: next.pubkey,
        ...(keptCipher === undefined ? {} : { ncryptsec: keptCipher }),
        ...(keptPlain === undefined ? {} : { nsec: keptPlain }),
        ...(keptPairing === undefined ? {} : { nip46: keptPairing }),
        session: next,
        persistent:
          keptCipher !== undefined ||
          keptPlain !== undefined ||
          keptPairing !== undefined ||
          next.status === 'readonly' ||
          (next.status === 'signed' && next.signer.kind === 'nip07'),
      }
      // Replacing the same pubkey with a new signer.
      if (existing !== undefined && existing.session !== next && !isShared(existing, ref.current)) {
        disposeSigner(existing.session)
      }
      const rest = ref.current.filter(a => a.pubkey !== next.pubkey)
      if (keep?.sole === true) {
        /* Everything else goes, so everything else has to be RELEASED. */
        for (const stale of rest) {
          if (!isShared(stale, ref.current)) disposeSigner(stale.session)
        }
        commit([account], next.pubkey)
        return true
      }
      commit([account, ...rest], next.pubkey)
      return true
    },
    [commit],
  )

  const switchTo = useCallback(
    (pubkey: Hex) => {
      if (!ref.current.some(a => a.pubkey === pubkey)) return
      commit(ref.current, pubkey)
    },
    [commit],
  )

  const signOut = useCallback(
    (pubkey?: Hex) => {
      const target = pubkey ?? activeRef.current
      if (target === undefined) return
      const going = ref.current.find(a => a.pubkey === target)
      if (going === undefined) return

      // Not disposed when another account holds the same signer object: closing a shared.
      if (!isShared(going, ref.current)) disposeSigner(going.session, true)

      const rest = ref.current.filter(a => a.pubkey !== target)
      const nextActive = target === activeRef.current ? rest[0]?.pubkey : activeRef.current
      // Signing out removes the stored ciphertext too, or the next load would offer.
      rememberLocked(lockedRef.current.filter(item => item.pubkey !== target))
      commit(rest, nextActive)
    },
    [commit],
  )

  /** Turn a locked account into a signed-in one. */
  const unlock = useCallback(
    (pubkey: Hex, passphrase: string) => {
      const entry = locked.find(item => item.pubkey === pubkey)
      if (entry === undefined) throw new Error('That account is not locked.')
      const secret = decryptNcryptsec(entry.ncryptsec, passphrase)
      try {
        const signer = PrivateKeySigner.fromSecretKey(secret)
        adopt({ status: 'signed', pubkey, signer }, { ncryptsec: entry.ncryptsec })
      } finally {
        secret.fill(0)
      }
      rememberLocked(lockedRef.current.filter(item => item.pubkey !== pubkey))
    },
    [locked, adopt, rememberLocked],
  )

  const signOutAll = useCallback(() => {
    const all = ref.current
    for (const account of all) {
      if (!isShared(account, all)) disposeSigner(account.session, true)
    }
    rememberLocked([])
    commit(NO_ACCOUNTS, undefined)
  }, [commit, rememberLocked])

  const session = useMemo<Session>(
    () => accounts.find(a => a.pubkey === activePubkey)?.session ?? ANONYMOUS,
    [accounts, activePubkey],
  )

  /** Preferences follow the identity in front. */
  useIsomorphicLayoutEffect(() => {
    setActiveScope(activePubkey)
  }, [activePubkey])

  const value = useMemo<SessionContextValue>(
    () => ({ session, accounts, ready, adopt, switchTo, signOut, signOutAll, locked, unlock }),
    [session, accounts, ready, adopt, switchTo, signOut, signOutAll, locked, unlock],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (value === null) throw new Error('useSession must be used inside <SessionProvider>')
  return value
}

/** The pubkey we are reading as, whether it can sign. */
export function sessionPubkey(session: Session): Hex | undefined {
  return session.status === 'anonymous' ? undefined : session.pubkey
}

export function sessionSigner(session: Session): Signer | undefined {
  return session.status === 'signed' ? session.signer : undefined
}
