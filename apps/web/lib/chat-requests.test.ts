import { beforeEach, describe, expect, it } from 'vitest'

import { deleteRequest, isDeletedRequest } from './chat-requests'
import { setActiveScope } from './scope'

/** A DELETED CONVERSATION STAYS DELETED. */

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const CONVERSATION = `${'0'.repeat(64)}:${'1'.repeat(64)}`

function signedInAs(pubkey: string): void {
  localStorage.setItem(
    'nostrich.accounts',
    JSON.stringify({
      accounts: [{ kind: 'readonly', pubkey: ALICE }, { kind: 'readonly', pubkey: BOB }],
      active: pubkey,
    }),
  )
  setActiveScope(pubkey)
}

beforeEach(() => {
  localStorage.clear()
  setActiveScope(undefined)
})

describe('chat request decisions', () => {
  it('remembers a deletion', () => {
    signedInAs(ALICE)
    deleteRequest(CONVERSATION)
    expect(isDeletedRequest(CONVERSATION)).toBe(true)
  })

  it('does not carry one reader\'s deletion into the other account', () => {
    signedInAs(ALICE)
    deleteRequest(CONVERSATION)
    signedInAs(BOB)
    expect(isDeletedRequest(CONVERSATION)).toBe(false)
  })

  it('restores the first account\'s deletions when it comes back to the front', () => {
    // The half that actually lost data: without a re-read, Alice's set was gone.
    signedInAs(ALICE)
    deleteRequest(CONVERSATION)
    signedInAs(BOB)
    signedInAs(ALICE)
    expect(isDeletedRequest(CONVERSATION)).toBe(true)
  })

  it('does not write one account\'s decisions into the other\'s storage', () => {
    signedInAs(ALICE)
    deleteRequest(CONVERSATION)
    signedInAs(BOB)
    deleteRequest('other:conversation')
    signedInAs(ALICE)
    expect(isDeletedRequest(CONVERSATION)).toBe(true)
    expect(isDeletedRequest('other:conversation')).toBe(false)
  })
})
