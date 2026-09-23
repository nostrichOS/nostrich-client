import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Hex } from '@nostrich/nostr'
import type { MuteEntry, MuteList } from '@nostrich/nostr'

import { withoutSelf } from './mute-sync'

/** A MUTE LIST MUST NEVER LAND IN ANOTHER ACCOUNT'S STORAGE. */
const source = readFileSync(join(__dirname, 'mute-sync.ts'), 'utf8')

describe('mute sync is pinned to the account it was started for', () => {
  it('checks the active scope after the remote read, not just `cancelled`', () => {
    expect(source).toContain('if (cancelled || activeScope() !== pubkey) return')
  })

  it('checks it again before publishing, so one account is never signed as another', () => {
    expect(source).toContain('if (activeScope() !== pubkey) return')
  })

  it('reads the scope from the module that owns it', () => {
    expect(source).toMatch(/import \{[^}]*activeScope[^}]*\} from '\.\/scope'/)
  })

  it('still cancels on unmount, the new guard is additional, not a replacement', () => {
    expect(source).toContain('cancelled = true')
  })
})

describe('withoutSelf', () => {
  const ME = 'a'.repeat(64) as Hex
  const THEM = 'b'.repeat(64) as Hex
  const list = (items: MuteEntry[]): MuteList => ({ publicItems: items, privateItems: [...items] })

  it('drops the publishing account from its own list, public half and private', () => {
    const cleaned = withoutSelf(list([{ type: 'p', value: ME }, { type: 'p', value: THEM }]), ME)
    expect(cleaned.publicItems).toEqual([{ type: 'p', value: THEM }])
    expect(cleaned.privateItems).toEqual([{ type: 'p', value: THEM }])
  })

  it('keeps everybody else, muting an account from another identity still means what it says', () => {
    const kept = withoutSelf(list([{ type: 'p', value: THEM }]), ME)
    expect(kept.publicItems).toEqual([{ type: 'p', value: THEM }])
  })

  it('leaves words and hashtags alone', () => {
    const terms = list([{ type: 'word', value: 'airdrop' }, { type: 't', value: 'politics' }])
    expect(withoutSelf(terms, ME)).toEqual(terms)
  })

  it('returns the same object when there is nothing to strip, so no needless republish', () => {
    const clean = list([{ type: 'p', value: THEM }])
    expect(withoutSelf(clean, ME)).toBe(clean)
  })
})

/** THE REPAIR HAS TO RUN WITHOUT THE READER KNOWING TO ASK. */
describe('a published list naming the reader repairs itself', () => {
  it('forces a corrective publish when the remote list names the reader', () => {
    expect(source).toContain('if (namesSelf) setRepair(count => count + 1)')
    expect(source).toMatch(/\}, \[version, repair, signer, pubkey\]\)/)
  })

  it('never adopts the reader into their own local list while hydrating', () => {
    expect(source).toContain('if (muted === pubkey) {')
  })

  it('strips the reader from the list it publishes', () => {
    expect(source).toContain('withoutSelf(')
  })
})
