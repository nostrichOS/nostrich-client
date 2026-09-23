import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { profileHandle } from '@nostrich/nostr'

/** WHICH ACCOUNT A NOTIFICATION LANDED ON, AND ONLY WHEN THAT IS A REAL QUESTION. */
const web = join(__dirname, '..')
const read = (...parts: string[]): string => readFileSync(join(web, ...parts), 'utf8')

describe('the qualifier appears only when there is an ambiguity', () => {
  const source = read('lib', 'connected-accounts.ts')

  it('is undefined below two connected accounts', () => {
    expect(source).toContain('if (viewer === undefined || accounts.length < 2) return undefined')
  })

  it('names the account by handle, falling back to a short key', () => {
    // An account whose kind-0 has not arrived is still one the reader must tell apart.
    expect(source).toContain('return profileHandle(profile) ?? displayKey(viewer)')
  })

  it('returns the handle WITHOUT a sigil, so the sentence owns the @', () => {
    // `profileHandle` is the shared one.
    expect(profileHandle({ name: 'bitcoinlimit' })).toBe('bitcoinlimit')
    expect(profileHandle({ nip05: 'karen@nostrich.org' })).toBe('karen')
    // `_@domain` is NIP-05's "the domain itself" form.
    expect(profileHandle({ nip05: '_@nostrich.org' })).toBe('nostrich.org')
    expect(profileHandle({})).toBeUndefined()
  })
})

describe('counting accounts works in the app, not just the browser', () => {
  const source = read('lib', 'connected-accounts.ts')

  /** THE TRAP THIS EXISTS TO AVOID. */
  it('reads the bridge when running as the app', () => {
    expect(source).toContain('return shell')
    expect(source).toContain('(shellAccounts as readonly Hex[])')
    expect(source).toContain('accounts.map(account => account.pubkey)')
  })

  it('is the same rule the switcher uses, named once', () => {
    // The rail resolves `shell.
    expect(read('components', 'LeftRail.tsx')).toContain('shell ? shellAccounts.length : accounts.length')
  })
})

describe('every row shape carries it, or none does', () => {
  const screen = read('components', 'NotificationsScreen.tsx')

  /* Three shapes draw a notification: the single row, the grouped row. */
  it('the single row', () => {
    expect(screen).toContain('<span className="min-w-0 truncate">on @{qualifier}</span>')
  })

  it('the grouped row', () => {
    expect(screen).toContain('<span className="text-text-muted"> on @{qualifier}</span>')
  })

  it('the reply/mention card', () => {
    expect(screen).toContain('{qualifier === undefined ? null : ` on @${qualifier}`}')
  })

  it('and the grouped row reads it before its early return', () => {
    // `GroupRow` bails when a group arrives empty.
    const group = screen.slice(screen.indexOf('export function GroupRow'))
    expect(group.indexOf('useAccountQualifier()')).toBeLessThan(group.indexOf('if (first === undefined) return null'))
  })
})
