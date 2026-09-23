import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** In the app, the other accounts are not in this session. */
const shell = readFileSync(join(__dirname, '..', 'components', 'AppShell.tsx'), 'utf8')
const rail = readFileSync(join(__dirname, '..', 'components', 'LeftRail.tsx'), 'utf8')

describe('account alerts in the native shell', () => {
  it('watches the shell’s accounts, not just the session’s', () => {
    expect(shell).toContain('const shellAccounts = useNativeShellAccounts()')
    expect(shell).toContain('.filter((pubkey) => pubkey !== chatPubkey)')
  })

  it('still watches session accounts in a browser', () => {
    // The browser path is unchanged: real sessions, with a private-key signer passed.
    expect(shell).toContain('account.session.signer.kind === "privatekey"')
  })

  it('passes no signer for a shell account, because none can cross the bridge', () => {
    // A key never leaves the keychain.
    expect(shell).toContain('.map((pubkey) => ({ pubkey: pubkey as Hex }))')
  })

  it('the rail still asks the question this answers', () => {
    // If this ever stops being how the dot is derived, the fix above is watching.
    expect(rail).toContain('const elsewhere = useAnyAccountAlerts(otherKeys)')
  })
})
