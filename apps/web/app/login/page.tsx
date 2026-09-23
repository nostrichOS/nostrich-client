import type { Metadata } from 'next'

import { LoginForm } from '../../components/LoginForm'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in with a browser extension, a remote signer, a private key, or read-only with an npub.',
}

export default function LoginPage() {
  return <LoginForm />
}
