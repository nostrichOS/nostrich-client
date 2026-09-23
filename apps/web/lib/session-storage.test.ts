import { beforeEach, describe, expect, it } from 'vitest'

import { clearStoredAccounts, hasStoredSession, readStoredAccounts, writeStoredAccounts } from './session-storage'

/** What survives a read of the accounts blob. */

const KEY = 'nostrich.accounts'
const hex = (seed: string): string => seed.repeat(64).slice(0, 64)

const nip07 = (seed: string) => ({ kind: 'nip07', pubkey: hex(seed) })
const readonly = (seed: string) => ({ kind: 'readonly', pubkey: hex(seed) })

beforeEach(() => {
  localStorage.clear()
})

describe('readStoredAccounts', () => {
  it('drops one unrecognised entry and keeps the rest', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        accounts: [nip07('a'), { kind: 'from-a-newer-build', pubkey: hex('b') }, readonly('c')],
        active: hex('a'),
      }),
    )

    const result = readStoredAccounts()

    expect(result.accounts.map(entry => entry.pubkey)).toEqual([hex('a'), hex('c')])
    expect(result.active).toBe(hex('a'))
  })

  it('leaves the other accounts ON DISK, not just in memory', () => {
    // The old failure was `clearStoredAccounts()` inside the read.
    localStorage.setItem(
      KEY,
      JSON.stringify({ accounts: [{ kind: 'unknown', pubkey: hex('b') }, nip07('a')] }),
    )

    readStoredAccounts()

    expect(localStorage.getItem(KEY)).not.toBeNull()
    expect(readStoredAccounts().accounts).toHaveLength(1)
  })

  it('truncates a too-long list instead of rejecting the whole blob', () => {
    const accounts = ['a', 'b', 'c', 'd', 'e', 'f'].map(seed => nip07(seed))
    localStorage.setItem(KEY, JSON.stringify({ accounts }))

    expect(readStoredAccounts().accounts).toHaveLength(5)
  })

  it('drops an unusable active pointer without losing the list', () => {
    localStorage.setItem(KEY, JSON.stringify({ accounts: [nip07('a')], active: 'not-a-pubkey' }))

    const result = readStoredAccounts()

    expect(result.accounts).toHaveLength(1)
    expect(result.active).toBeUndefined()
  })

  it('still clears genuine corruption', () => {
    localStorage.setItem(KEY, '{not json at all')
    expect(readStoredAccounts().accounts).toEqual([])
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('round-trips what it wrote', () => {
    writeStoredAccounts({ accounts: [nip07('a'), readonly('b')] as never, active: hex('b') })

    const result = readStoredAccounts()

    expect(result.accounts).toHaveLength(2)
    expect(result.active).toBe(hex('b'))
  })
})

describe('hasStoredSession', () => {
  it('is false for an empty record', () => {
    // Written when the last account is removed.
    localStorage.setItem(KEY, JSON.stringify({ accounts: [] }))
    expect(hasStoredSession()).toBe(false)
  })

  it('is false with nothing stored at all', () => {
    expect(hasStoredSession()).toBe(false)
  })

  it('is true when there is a real account', () => {
    localStorage.setItem(KEY, JSON.stringify({ accounts: [nip07('a')] }))
    expect(hasStoredSession()).toBe(true)
  })

  it('counts an entry whose kind this build does not know', () => {
    // Deliberately schema-free: a session written by a newer build is still a session.
    localStorage.setItem(KEY, JSON.stringify({ accounts: [{ kind: 'nip46', pubkey: hex('a') }] }))
    expect(hasStoredSession()).toBe(true)
  })

  it('is false for an entry with no usable pubkey', () => {
    localStorage.setItem(KEY, JSON.stringify({ accounts: [{ kind: 'nip07', pubkey: 'nope' }] }))
    expect(hasStoredSession()).toBe(false)
  })
})

describe('clearStoredAccounts', () => {
  it('removes the record', () => {
    localStorage.setItem(KEY, JSON.stringify({ accounts: [nip07('a')] }))
    clearStoredAccounts()
    expect(hasStoredSession()).toBe(false)
  })
})

/** The bug this whole change exists for: a remote-signer account must round-trip. */
describe('a remote-signer pairing', () => {
  const pairing = {
    kind: 'nip46',
    pubkey: hex('a'),
    clientSecretKey: hex('b'),
    remoteSignerPubkey: hex('c'),
    relays: ['wss://relay.example/'],
    perms: ['sign_event:1', 'nip44_decrypt'],
  }

  it('survives a write and a read', () => {
    writeStoredAccounts({ accounts: [pairing] as never, active: hex('a') })

    const [entry] = readStoredAccounts().accounts
    expect(entry?.kind).toBe('nip46')
    // The transport key is the whole point: without it the signer sees a stranger.
    expect(entry).toMatchObject({
      clientSecretKey: hex('b'),
      remoteSignerPubkey: hex('c'),
      perms: ['sign_event:1', 'nip44_decrypt'],
    })
  })

  it('counts as a stored session, so the first paint is the signed-in one', () => {
    writeStoredAccounts({ accounts: [pairing] as never })
    expect(hasStoredSession()).toBe(true)
  })

  it('survives beside an entry this build does not understand', () => {
    // The rollout case: another tab or a newer deploy wrote something we cannot parse.
    localStorage.setItem(
      KEY,
      JSON.stringify({ accounts: [{ kind: 'from-the-future', pubkey: hex('d') }, pairing] }),
    )

    const accounts = readStoredAccounts().accounts
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.kind).toBe('nip46')
  })

  it('is rejected when the relay list is empty, since it could never reconnect', () => {
    localStorage.setItem(KEY, JSON.stringify({ accounts: [{ ...pairing, relays: [] }] }))
    expect(readStoredAccounts().accounts).toHaveLength(0)
  })
})

/** A STORED NSEC SURVIVES, because signing in once means signing. */
describe('a stored nsec', () => {
  // Never decoded here.
  const NSEC = 'nsec1-placeholder-not-a-real-key'
  const stored = (seed: string) => ({ kind: 'privatekey', pubkey: hex(seed), nsec: NSEC })

  it('comes back as an account after a reload', () => {
    localStorage.setItem(KEY, JSON.stringify({ accounts: [stored('a')], active: hex('a') }))
    const result = readStoredAccounts()
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0]).toMatchObject({ kind: 'privatekey', pubkey: hex('a') })
    expect(result.active).toBe(hex('a'))
  })

  it('is not quietly deleted by the read that finds it', () => {
    localStorage.setItem(KEY, JSON.stringify({ accounts: [stored('a')], active: hex('a') }))
    readStoredAccounts()
    // It may be the reader's only copy of a key that cannot be reissued.
    expect(localStorage.getItem(KEY) ?? '').toContain(NSEC)
  })

  it('round-trips beside the reader\'s other accounts', () => {
    writeStoredAccounts({
      accounts: [stored('a') as never, nip07('b') as never, readonly('c') as never],
      active: hex('a'),
    })
    const result = readStoredAccounts()
    expect(result.accounts.map(entry => entry.kind)).toEqual(['privatekey', 'nip07', 'readonly'])
    expect(localStorage.getItem(KEY) ?? '').toContain(NSEC)
  })

  it('counts as a stored session, so the first paint is the signed-in one', () => {
    localStorage.setItem(KEY, JSON.stringify({ accounts: [stored('a')], active: hex('a') }))
    expect(hasStoredSession()).toBe(true)
  })

  /** The encrypted form is untouched by any. */
  it('leaves an encrypted key alone', () => {
    const ncryptsec = 'ncryptsec1' + 'q'.repeat(50)
    localStorage.setItem(
      KEY,
      JSON.stringify({ accounts: [{ kind: 'ncryptsec', pubkey: hex('a'), ncryptsec }], active: hex('a') }),
    )
    expect(readStoredAccounts().accounts).toHaveLength(1)
    expect(localStorage.getItem(KEY) ?? '').toContain(ncryptsec)
  })
})
