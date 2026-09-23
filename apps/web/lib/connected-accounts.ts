'use client'

import { profileHandle, type Hex } from '@nostrich/nostr'

import { sessionPubkey, useSession } from '../components/SessionProvider'
import { displayKey } from './format'
import { useIsNativeShell, useNativeShellAccounts } from './native-shell'
import { useProfile } from './profiles'

/** WHICH ACCOUNTS THIS READER HAS CONNECTED. */
export function useConnectedAccounts(): readonly Hex[] {
  const { accounts } = useSession()
  const shell = useIsNativeShell()
  const shellAccounts = useNativeShellAccounts()
  return shell
    ? (shellAccounts as readonly Hex[])
    : accounts.map(account => account.pubkey)
}

/** WHICH OF YOUR ACCOUNTS A NOTIFICATION LANDED. */
export function useAccountQualifier(): string | undefined {
  const { session } = useSession()
  const viewer = sessionPubkey(session)
  const accounts = useConnectedAccounts()
  const profile = useProfile(viewer)

  if (viewer === undefined || accounts.length < 2) return undefined
  // `displayKey` rather than nothing: an account whose kind-0 has not arrived is still.
  return profileHandle(profile) ?? displayKey(viewer)
}
