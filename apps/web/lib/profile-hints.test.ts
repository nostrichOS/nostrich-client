import { beforeEach, describe, expect, it } from 'vitest'

import { forgetProfileHints, profileHints, rememberProfileHints } from './profile-hints'
import type { RelayUrl } from '@nostrich/nostr'

/** Where a mention says its subject can be found. */

const ALICE = 'a'.repeat(64)
const relay = (url: string): RelayUrl => url as RelayUrl

beforeEach(forgetProfileHints)

describe('remembering', () => {
  it('keeps what a mention named', () => {
    rememberProfileHints(ALICE, [relay('wss://relay-d.example/')])
    expect(profileHints(ALICE)).toEqual(['wss://relay-d.example/'])
  })

  it('has nothing to say about somebody never mentioned', () => {
    expect(profileHints('b'.repeat(64))).toEqual([])
  })

  it('does not repeat itself when the same person is mentioned twice', () => {
    rememberProfileHints(ALICE, [relay('wss://relay-d.example/')])
    rememberProfileHints(ALICE, [relay('wss://relay-d.example/')])
    expect(profileHints(ALICE)).toHaveLength(1)
  })

  it('stops at two, because a pointer naming five relays is not being more helpful', () => {
    rememberProfileHints(ALICE, [
      relay('wss://one.example/'),
      relay('wss://two.example/'),
      relay('wss://three.example/'),
    ])
    expect(profileHints(ALICE)).toHaveLength(2)
  })
})

describe('what a stranger cannot make this browser connect to', () => {
  it('refuses loopback and private addresses', () => {
    // A note is untrusted input and this ends in a websocket connection.
    rememberProfileHints(ALICE, [
      relay('ws://127.0.0.1:7777/'),
      relay('ws://localhost:8080/'),
      relay('ws://192.168.1.10/'),
    ])
    expect(profileHints(ALICE)).toEqual([])
  })

  it('keeps the public one out of a mixed list', () => {
    rememberProfileHints(ALICE, [relay('ws://10.0.0.5/'), relay('wss://relay-d.example/')])
    expect(profileHints(ALICE)).toEqual(['wss://relay-d.example/'])
  })
})
