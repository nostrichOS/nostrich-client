import { describe, expect, it } from 'vitest'

import { CLIENT_TAG_NAME, NEVER_CLIENT_TAGGED, withClientTag } from './client-tag'
import { PrivateKeySigner } from './signers/privatekey'
import type { EventTemplate } from './types'

/** WHICH EVENTS WEAR THE CLIENT TAG, pinned. */

const t = (kind: number, tags: string[][] = []): EventTemplate => ({
  kind,
  created_at: 1,
  tags,
  content: '',
})

describe('withClientTag', () => {
  it('is exactly one bare NIP-89 tag, lowercase', () => {
    expect(withClientTag(t(1)).tags).toEqual([['client', 'nostrich']])
    expect(CLIENT_TAG_NAME).toBe('nostrich')
  })

  it('stamps every ordinary kind, including ones no builder here knows about yet', () => {
    // 1 note/reply, 6 repost, 7 reaction, 16 generic repost, 1111 comment, 9734 zap.
    for (const kind of [
      0, 1, 3, 5, 6, 7, 16, 1984, 1111, 9734, 10000, 10002, 10003, 30023, 30078, 30402, 31337,
    ]) {
      expect(withClientTag(t(kind)).tags).toEqual([['client', CLIENT_TAG_NAME]])
    }
  })

  it('NEVER touches the NIP-17 direct-message chain', () => {
    // The gift wrap is signed by a throwaway key so nothing outside it links to the sender.
    for (const kind of [13, 14, 15, 1059]) {
      expect(NEVER_CLIENT_TAGGED.has(kind)).toBe(true)
      expect(withClientTag(t(kind)).tags).toEqual([])
    }
  })

  it('never touches credentials or encrypted RPC', () => {
    // NIP-98 http auth, Blossom auth, relay auth, NIP-46, NWC request/response.
    for (const kind of [27235, 24242, 22242, 24133, 23194, 23195]) {
      expect(NEVER_CLIENT_TAGGED.has(kind)).toBe(true)
      expect(withClientTag(t(kind)).tags).toEqual([])
    }
  })

  it('returns the very same object when it changes nothing', () => {
    // `templateMismatch` compares what was sent against what came back.
    const wrap = t(1059)
    expect(withClientTag(wrap)).toBe(wrap)
  })

  it('leaves a caller-supplied client tag alone rather than adding a second', () => {
    expect(withClientTag(t(1, [['client', 'somethingelse']])).tags).toEqual([
      ['client', 'somethingelse'],
    ])
  })

  it('keeps the caller tags in front of it', () => {
    expect(withClientTag(t(1, [['t', 'nostr']])).tags).toEqual([
      ['t', 'nostr'],
      ['client', CLIENT_TAG_NAME],
    ])
  })
})

describe('the signer applies it', () => {
  it('signs a note WITH the tag and a gift wrap WITHOUT it', async () => {
    const signer = PrivateKeySigner.generate()

    const note = await signer.signEvent(t(1))
    expect(note.tags).toEqual([['client', CLIENT_TAG_NAME]])

    const wrap = await signer.signEvent(t(1059))
    expect(wrap.tags).toEqual([])
  })

  it('does not mutate the template it was handed', async () => {
    const signer = PrivateKeySigner.generate()
    const original = t(1)
    await signer.signEvent(original)
    expect(original.tags).toEqual([])
  })
})
