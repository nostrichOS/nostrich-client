import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { wipeLocalData } from './delete-account'
import { writeScoped, setActiveScope } from './scope'
import type { Hex } from '@nostrich/nostr'

/** Deleting an account, on a protocol where there is no account to delete. */
const ME = 'a'.repeat(64) as Hex
const OTHER = 'b'.repeat(64) as Hex

describe('wipeLocalData', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('removes this account’s scoped entries', () => {
    setActiveScope(ME)
    writeScoped('nostrich.feeds', '["one"]')
    writeScoped('nostrich.deck', '{"columns":[]}')
    expect(wipeLocalData(ME)).toBe(2)
    expect(localStorage.length).toBe(0)
  })

  it('LEAVES ANOTHER ACCOUNT ALONE, the reason this is not localStorage.clear()', () => {
    /* Two people share a browser, or one person has two identities. */
    setActiveScope(OTHER)
    writeScoped('nostrich.feeds', '["theirs"]')
    setActiveScope(ME)
    writeScoped('nostrich.feeds', '["mine"]')

    expect(wipeLocalData(ME)).toBe(1)

    setActiveScope(OTHER)
    const survivors: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key !== null) survivors.push(key)
    }
    expect(survivors.some(key => key.endsWith(OTHER))).toBe(true)
    expect(survivors.some(key => key.endsWith(ME))).toBe(false)
  })

  it('leaves DEVICE-WIDE settings alone', () => {
    // Theme, text size and relay choices name nobody.
    localStorage.setItem('nostrich.theme', 'dark')
    localStorage.setItem('nostrich.textSize', 'large')
    setActiveScope(ME)
    writeScoped('nostrich.feeds', '["mine"]')

    expect(wipeLocalData(ME)).toBe(1)
    expect(localStorage.getItem('nostrich.theme')).toBe('dark')
    expect(localStorage.getItem('nostrich.textSize')).toBe('large')
  })

  it('reports zero rather than throwing when there is nothing to remove', () => {
    expect(wipeLocalData(ME)).toBe(0)
  })
})

/** The order, which is the whole design and is not observable from a unit test of one. */
const source = readFileSync(join(__dirname, 'delete-account.ts'), 'utf8')
const section = readFileSync(
  join(__dirname, '..', 'components', 'DeleteAccountSection.tsx'),
  'utf8',
)

describe('the profile it publishes', () => {
  const core = readFileSync(
    join(__dirname, '..', '..', '..', 'packages', 'nostr', 'src', 'delete-account.ts'),
    'utf8',
  )

  it('is a TOMBSTONE, not an empty profile', () => {
    /* This published `{}` first. */
    expect(core).toContain("export const DELETED_PROFILE_NAME = 'Deleted Account'")
    expect(core).toContain('name: DELETED_PROFILE_NAME')
    expect(core).toContain('display_name: DELETED_PROFILE_NAME')
  })

  it('carries the deleted flag, for the clients that read it', () => {
    expect(core).toContain('deleted: true')
  })

  it('drops the lightning address with everything else', () => {
    // The field that matters most of the ones left out: keeping it would leave a zap.
    expect(core).not.toContain('lud16')
    expect(core).not.toContain('picture:')
  })
})

describe('the sequence', () => {
  it('signs and publishes BEFORE wiping anything', () => {
    const run = source.slice(source.indexOf('export async function deleteAccount'))
    expect(run.indexOf('leaveTheNetwork')).toBeLessThan(run.indexOf('wipeLocalData'))
  })

  it('signs out only after the work is done', () => {
    // In the component, not in `deleteAccount`.
    expect(source).not.toContain('signOut(')
    const then = section.slice(section.indexOf('.then(outcome =>'))
    expect(then).toContain('signOut(pubkey)')
  })

  it('tells the APP to forget the key, not just the page', () => {
    /* Without this the page session clears and the app signs straight back in on the next. */
    expect(section).toContain('if (shell) nativeShellSignOut(pubkey)')
  })

  it('deletes the OLD profile, never the blank one that replaced it', () => {
    /* The subtlest way this could go wrong. */
    expect(source).toContain('const previous = await currentProfile(pubkey)')
    expect(source).toContain('buildDeletion([previous], pubkey')
    expect(source).not.toContain('buildDeletion([blank]')
  })

  it('reuses the shared kind-5 builder rather than a second one', () => {
    // `events.ts` has done deletions for months, including `a` tags for addressable events.
    expect(source).toContain("from '@nostrich/nostr'")
    expect(source).toContain('buildDeletion')
    const core = readFileSync(
      join(__dirname, '..', '..', '..', 'packages', 'nostr', 'src', 'delete-account.ts'),
      'utf8',
    )
    expect(core).not.toContain('export function buildDeletion')
  })

  it('never lets one failed step abandon the rest', () => {
    // A reader who pressed this asked to leave, so every step reports and the sequence.
    expect(source).toContain('profileBlanked = false')
    expect(source).toContain('deletionRequested = false')
  })
})

describe('the confirmation', () => {
  it('requires the exact uppercase word', () => {
    expect(section).toContain("const armed = typed === 'DELETE'")
  })

  it('is hidden until the reader asks for it', () => {
    /* A confirmation field sitting open on the page is furniture: read. */
    expect(section).toContain('const [asking, setAsking] = useState(false)')
    expect(section).toContain('{asking ? (')
    expect(section).toContain('onClick={() => setAsking(true)}')
  })

  it('can be backed out of', () => {
    // The two-step flow creates this need.
    expect(section).toContain('setAsking(false)')
  })

  it('uses the shared danger button rather than a hand-rolled red', () => {
    // `BUTTON_DANGER` is `bg-danger` / `text-on-danger`.
    expect(section).toContain('BUTTON_DANGER')
    expect(section).not.toContain('rounded-full')
    const styles = readFileSync(join(__dirname, 'styles.ts'), 'utf8')
    expect(styles).toContain('export const BUTTON_DANGER = `${BUTTON_BASE} border border-danger-border bg-danger-surface text-danger-text hover:bg-danger-border`')
  })

  it('carries the same trash glyph the rest of the app uses for removal', () => {
    // Relays, media servers and the chat menu all use this one.
    expect(section).toContain('material-symbols-outlined')
    expect(section).toContain('delete')
  })

  it('does not let a phone keyboard fill it in', () => {
    // Autocapitalise would type the confirmation FOR them, which is the one thing.
    expect(section).toContain('autoCapitalize="none"')
    expect(section).toContain('autoCorrect="off"')
  })

  it('offers nothing when there is no key to erase', () => {
    // Signed out, or read-only from a pasted npub: nothing to sign with and nothing.
    expect(section).toContain('if (pubkey === undefined || signer === undefined) return null')
  })

  it('is lean, no essay in front of somebody who has decided to leave', () => {
    // It began as three headed paragraphs of relay semantics.
    expect(section).not.toContain('<dl')
    expect(section).toContain('This will permanently delete your Nostr account.')
  })
})
