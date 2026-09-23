import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** SIGNING INTO A SECOND ACCOUNT IN THE APP MUST NOT LAND YOU BACK ON THE FIRST. */
const shell = readFileSync(join(__dirname, 'native-shell.ts'), 'utf8')
const provider = readFileSync(join(__dirname, '..', 'components', 'SessionProvider.tsx'), 'utf8')

/** The body of the hook, so an assertion cannot be satisfied by some other function's. */
const hook = shell.slice(
  shell.indexOf('export function useNativeShellSession'),
  shell.indexOf('* Take approval prompts from the app'),
)

describe('the bridge is asked who it is holding', () => {
  it('does NOT return early merely because the page is already signed in', () => {
    // The one line that caused.
    expect(hook).not.toContain("if (session.status === 'signed') return")
  })

  it('asks the bridge before deciding anything', () => {
    expect(hook).toContain('await signer.getPublicKey()')
  })

  it('adopts when the bridge disagrees with the stored session', () => {
    expect(hook).toContain("adopt({ status: 'signed', pubkey, signer }, { sole: true })")
  })

  it('leaves an already-correct session alone', () => {
    // Adopting unconditionally would rewrite the account list on every load in the app.
    expect(hook).toContain("held.status === 'signed' && held.pubkey === pubkey")
  })
})

describe('it stays one bridge message per load', () => {
  /* The reason the early return existed. */
  it('still guards with a once-per-load ref', () => {
    expect(hook).toContain('const tried = useRef(false)')
    expect(hook).toContain('if (!ready || tried.current) return')
    expect(hook).toContain('tried.current = true')
  })

  it('does not re-run on every session change', () => {
    // `session.status` in the deps would re-arm the effect each time the session moved.
    expect(hook).toContain('}, [adopt, ready])')
    expect(hook).toContain('const current = useRef(session)')
  })

  it('is still confined to the app', () => {
    // Nothing here may change what a browser extension does.
    expect(hook).toContain('if (!isNativeShell()) return')
    expect(shell).toContain('.nostr?.isNostrich === true')
  })
})

describe('why a stale session was believable in the first place', () => {
  it('a restored nip07 session trusts its stored pubkey', () => {
    /* Correct for an extension, whose identity is stable across loads and changes only. */
    expect(provider).toContain("session: { status: 'signed', pubkey: entry.pubkey, signer: new Nip07Signer() }")
  })

  it('and is persisted, which is what carried it across the reload', () => {
    expect(provider).toContain("(next.status === 'signed' && next.signer.kind === 'nip07')")
  })
})

/** THE PAGE'S ACCOUNT LIST IS A CACHE IN THE APP, NOT A REGISTRY. */
describe('the shell replaces its account list rather than growing it', () => {
  it('adopts as the sole account', () => {
    expect(hook).toContain('{ sole: true }')
  })

  it('the provider replaces the list for a sole adoption', () => {
    expect(provider).toContain('if (keep?.sole === true)')
    expect(provider).toContain('commit([account], next.pubkey)')
  })

  it('releases the signers it drops', () => {
    /* A dropped account still holding a live signer is a bunker socket nothing will ever. */
    expect(provider).toContain('for (const stale of rest)')
    expect(provider).toContain('if (!isShared(stale, ref.current)) disposeSigner(stale.session)')
  })

  it('does NOT let the account ceiling refuse a replacement', () => {
    // The ceiling exists to stop a list growing.
    expect(provider).toContain("if (keep?.sole !== true && existing === undefined && ref.current.length >= MAX_ACCOUNTS)")
  })

  it('leaves the browser path appending, which is correct there', () => {
    // The unconditional commit is still the last line of `adopt`, for everybody.
    expect(provider).toContain('commit([account, ...rest], next.pubkey)')
  })
})
