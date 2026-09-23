'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { nativeShellSignIn, useIsNativeShell } from '../lib/native-shell'

import { LINK, PAGE } from '../lib/styles'
import { ContentLink } from './ContentLink'
import { DissolvingWord } from './DissolvingWord'
import { SignInPanel } from './SignInPanel'

/** The /login route. */
export function LoginForm(): React.ReactNode {
  const router = useRouter()

  /* Inside the native app this page never renders. */
  const shell = useIsNativeShell()

  useEffect(() => {
    if (!shell) return
    nativeShellSignIn()
    router.replace('/')
  }, [router, shell])

  if (shell) return null

  return (
    <div className={PAGE}>
      {/* Mono, letterspaced, behind a short rule. */}
      <p className="mt-4 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-text-faint">
        <span aria-hidden="true" className="h-px w-[22px] bg-border-strong" />
        Sign in to your Nostr identity
      </p>

      {/* The headline is the whole point of the masthead. */}
      <h1 className="mt-4 font-brand text-[clamp(34px,7vw,50px)] font-extrabold leading-[1.02] tracking-[-0.035em] text-text">
        {/* Broken explicitly into two blocks rather than left to wrap inside a `max-w`. */}
        <span className="block">
          An <DissolvingWord>identity</DissolvingWord> nobody
        </span>
        <span className="block">can take away.</span>
      </h1>

      {/* No max-width. */}
      <p className="mt-4 text-[16.5px] leading-relaxed text-text-muted">
        Nostr has no sign-ups or passwords. Your identity is a cryptographic keypair you control
        and can use across Nostr apps. Learn more at{' '}
        <ContentLink href="https://nostr.org" className={LINK}>
          nostr.org
        </ContentLink>
      </p>

      {/* Arriving here directly means there was no page behind to return to, so finishing. */}
      <div className="mt-8">
        <SignInPanel onDone={() => router.push('/')} />
      </div>
    </div>
  )
}
