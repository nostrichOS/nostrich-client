'use client'

import { useEffect, useRef, useState } from 'react'
import { Nip07Signer } from '@nostrich/nostr'

import { useSession } from '../components/SessionProvider'
import { patientSigner } from './patient-signer'
import { askToApprove } from './signer-approval'

/** Signing in when this page is the native app's own surface. */

interface MaybeProvider {
  isNostrich?: boolean
  getPublicKey?: () => Promise<string>
}

/** The shell channel. */
interface ShellChannel {
  accounts?: string[]
  active?: string | null
  /** True when the active account signs on another device. */
  remote?: boolean
  ask?: (kind: 'signIn' | 'switch' | 'signOut', payload?: { pubkey?: string }) => void
}

interface ApprovalChannel {
  __nostrichOnApprove?: (url: string) => void
  __nostrichPendingApproval?: string | null
}

function channel(): ShellChannel | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as { __nostrichShell?: ShellChannel }).__nostrichShell
}

/** Every account in the phone's keychain, active one included. */
export function nativeShellAccounts(): string[] {
  return channel()?.accounts ?? []
}

/** Re-rendered when the app hands over a new list. */
export function useNativeShellAccounts(): string[] {
  const [accounts, setAccounts] = useState<string[]>([])

  useEffect(() => {
    if (!isNativeShell()) return
    const read = (): void => setAccounts(nativeShellAccounts())
    read()
    window.addEventListener('nostrich:accounts', read)
    return () => window.removeEventListener('nostrich:accounts', read)
  }, [])

  return accounts
}

/** Open the app's own sign-in screen. */
export function nativeShellSignIn(): void {
  channel()?.ask?.('signIn')
}

/** Make another keychain account active. */
export function nativeShellSwitch(pubkey: string): void {
  channel()?.ask?.('switch', { pubkey })
}

/** Forget a key. */
export function nativeShellSignOut(pubkey?: string): void {
  channel()?.ask?.('signOut', pubkey === undefined ? {} : { pubkey })
}

/** THE APP DOES NOT PINCH-ZOOM. A browser still does. */
export function useNativeShellZoomLock(): void {
  useEffect(() => {
    if (!isNativeShell()) return
    const root = document.documentElement
    const held = root.style.touchAction
    root.style.touchAction = 'pan-x pan-y'
    return () => {
      root.style.touchAction = held
    }
  }, [])
}

/** True when this page is running inside our own app shell rather than in a browser. */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  return (window as { nostr?: MaybeProvider }).nostr?.isNostrich === true
}

/** The same answer, safe to branch on while RENDERING. */
export function useIsNativeShell(): boolean {
  const [shell, setShell] = useState(false)
  useEffect(() => {
    if (isNativeShell()) setShell(true)
  }, [])
  return shell
}

export function useNativeShellSession(): void {
  const { session, ready, adopt } = useSession()
  /* Once per load. */
  const tried = useRef(false)
  /* Read inside the effect without making the effect depend on it: `session` changes. */
  const current = useRef(session)
  current.current = session

  useEffect(() => {
    if (!ready || tried.current) return
    if (!isNativeShell()) return
    tried.current = true

    void (async () => {
      try {
        /* Wrapped only when the key is on ANOTHER device. */
        const raw = new Nip07Signer()
        const signer = channel()?.remote === true ? patientSigner(raw) : raw
        const pubkey = await signer.getPublicKey()
        /* IN THE SHELL THE BRIDGE IS THE AUTHORITY ON WHO IS SIGNED IN, and the stored. */
        const held = current.current
        if (held.status === 'signed' && held.pubkey === pubkey) return
        /* `sole`. */
        adopt({ status: 'signed', pubkey, signer }, { sole: true })
      } catch {
        /* Deliberately silent. */
      }
    })()
    /* `session.status` is deliberately NOT a dependency any more. */
  }, [adopt, ready])
}

/** Take approval prompts from the app. */
export function useNativeShellApprovals(): void {
  useEffect(() => {
    if (!isNativeShell()) return
    const shell = window as unknown as ApprovalChannel
    shell.__nostrichOnApprove = askToApprove
    const parked = shell.__nostrichPendingApproval
    if (typeof parked === 'string' && parked !== '') {
      shell.__nostrichPendingApproval = null
      askToApprove(parked)
    }
    return () => {
      shell.__nostrichOnApprove = undefined
    }
  }, [])
}
