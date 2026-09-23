import { describe, expect, it } from 'vitest'

import { npubEncode } from 'nostr-tools/nip19'

import { buildReply, buildReplyTags, buildThreadTree, flattenThread, parseThread, replyContext } from './thread'
import type { NostrEvent } from './types'

const hex = (seed: string): string => seed.repeat(32).slice(0, 64)

const ROOT = hex('11')
const MID = hex('22')
const LEAF = hex('33')
const QUOTED = hex('44')

const ALICE = hex('aa')
const BOB = hex('bb')
const CAROL = hex('cc')
const ME = hex('dd')

function event(overrides: Partial<NostrEvent> & Pick<NostrEvent, 'id'>): NostrEvent {
  return {
    pubkey: ALICE,
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: '',
    sig: '0'.repeat(128),
    ...overrides,
  }
}

describe('parseThread, legacy positional form', () => {
  it('treats a lone e-tag as both root and parent', () => {
    expect(parseThread(event({ id: LEAF, tags: [['e', ROOT]] }))).toEqual({
      rootId: ROOT,
      replyToId: ROOT,
      mentionedPubkeys: [],
    })
  })

  it('takes the first e-tag as root and the last as parent', () => {
    const reply = event({
      id: LEAF,
      tags: [
        ['e', ROOT],
        ['e', QUOTED],
        ['e', MID],
        ['p', ALICE],
        ['p', BOB],
      ],
    })
    expect(parseThread(reply)).toEqual({ rootId: ROOT, replyToId: MID, mentionedPubkeys: [ALICE, BOB] })
  })

  it('reports a note with no e-tags as top level', () => {
    expect(parseThread(event({ id: LEAF, tags: [['p', ALICE]] }))).toEqual({ mentionedPubkeys: [ALICE] })
  })

  it('ignores e-tags whose id is not 64-char hex', () => {
    expect(parseThread(event({ id: LEAF, tags: [['e', 'note1nonsense'], ['e', ROOT]] }))).toEqual({
      rootId: ROOT,
      replyToId: ROOT,
      mentionedPubkeys: [],
    })
  })
})

describe('parseThread, marked form', () => {
  it('reads markers regardless of tag order', () => {
    const reply = event({
      id: LEAF,
      tags: [
        ['e', MID, 'wss://relay.example', 'reply', BOB],
        ['e', ROOT, '', 'root', ALICE],
      ],
    })
    expect(parseThread(reply)).toEqual({ rootId: ROOT, replyToId: MID, mentionedPubkeys: [] })
  })

  it('treats a root-only marker as a direct reply to the root', () => {
    expect(parseThread(event({ id: LEAF, tags: [['e', ROOT, '', 'root', ALICE]] }))).toEqual({
      rootId: ROOT,
      replyToId: ROOT,
      mentionedPubkeys: [],
    })
  })

  it('falls back to the parent as root when only a reply marker is present', () => {
    expect(parseThread(event({ id: LEAF, tags: [['e', MID, '', 'reply']] }))).toEqual({
      rootId: MID,
      replyToId: MID,
      mentionedPubkeys: [],
    })
  })

  it('keeps a mention-only note top level instead of reading it positionally', () => {
    const quote = event({ id: LEAF, tags: [['e', QUOTED, '', 'mention']] })
    expect(parseThread(quote)).toEqual({ mentionedPubkeys: [] })
  })

  it('does not let a mention marker become the root of a real reply', () => {
    const reply = event({
      id: LEAF,
      tags: [
        ['e', QUOTED, '', 'mention'],
        ['e', ROOT, '', 'root'],
        ['e', MID, '', 'reply'],
      ],
    })
    expect(parseThread(reply)).toEqual({ rootId: ROOT, replyToId: MID, mentionedPubkeys: [] })
  })

  it('uses a trailing unmarked tag as the parent when only the root is marked', () => {
    const reply = event({
      id: LEAF,
      tags: [
        ['e', ROOT, '', 'root'],
        ['e', MID],
      ],
    })
    expect(parseThread(reply)).toEqual({ rootId: ROOT, replyToId: MID, mentionedPubkeys: [] })
  })

  it('deduplicates and lowercases carried pubkeys', () => {
    const reply = event({
      id: LEAF,
      tags: [
        ['e', ROOT, '', 'root'],
        ['p', ALICE.toUpperCase()],
        ['p', ALICE],
        ['p', 'not-hex'],
      ],
    })
    expect(parseThread(reply).mentionedPubkeys).toEqual([ALICE])
  })
})

describe('buildReplyTags', () => {
  it('emits a single root-marked tag when replying to a top-level note', () => {
    const parent = event({ id: ROOT, pubkey: ALICE })
    expect(buildReplyTags(parent, { authorPubkey: ME })).toEqual([
      ['e', ROOT, '', 'root', ALICE],
      ['p', ALICE],
    ])
  })

  it('puts the root first and the parent last so both conventions agree', () => {
    const parent = event({
      id: MID,
      pubkey: BOB,
      tags: [
        ['e', ROOT, '', 'root', ALICE],
        ['p', ALICE],
      ],
    })
    const tags = buildReplyTags(parent, { authorPubkey: ME, relay: 'wss://Relay.Example/' })
    expect(tags).toEqual([
      ['e', ROOT, '', 'root', ALICE],
      ['e', MID, 'wss://relay.example', 'reply', BOB],
      ['p', BOB],
      ['p', ALICE],
    ])

    const eTags = tags.filter(tag => tag[0] === 'e')
    expect(eTags[0]?.[1]).toBe(ROOT)
    expect(eTags[eTags.length - 1]?.[1]).toBe(MID)
  })

  it('round-trips through the marked reader', () => {
    const parent = event({ id: MID, pubkey: BOB, tags: [['e', ROOT, '', 'root', ALICE]] })
    const reply = event({ id: LEAF, pubkey: ME, tags: buildReplyTags(parent, { authorPubkey: ME }) })
    expect(parseThread(reply)).toEqual({ rootId: ROOT, replyToId: MID, mentionedPubkeys: [BOB] })
  })

  it('round-trips through the positional reader', () => {
    const parent = event({ id: MID, pubkey: BOB, tags: [['e', ROOT, '', 'root', ALICE]] })
    const tags = buildReplyTags(parent, { authorPubkey: ME }).map(tag => tag.slice(0, 3))
    const legacyReader = event({ id: LEAF, pubkey: ME, tags })
    expect(parseThread(legacyReader)).toEqual({ rootId: ROOT, replyToId: MID, mentionedPubkeys: [BOB] })
  })

  it('carries the conversation forward without notifying the author or repeating anyone', () => {
    const parent = event({
      id: MID,
      pubkey: BOB,
      tags: [
        ['e', ROOT, '', 'root'],
        ['p', BOB],
        ['p', ALICE],
        ['p', ME],
      ],
    })
    const tags = buildReplyTags(parent, { authorPubkey: ME, extraPubkeys: [CAROL, ALICE] })
    // Answered first, then deliberately named, then inherited from the thread.
    expect(tags.filter(tag => tag[0] === 'p')).toEqual([
      ['p', BOB],
      ['p', CAROL],
      ['p', ALICE],
    ])
  })

  it('caps carried pubkeys, keeping the parent author', () => {
    const parent = event({
      id: MID,
      pubkey: BOB,
      tags: [
        ['e', ROOT, '', 'root'],
        ['p', ALICE],
        ['p', CAROL],
      ],
    })
    expect(buildReplyTags(parent, { maxPubkeys: 2 }).filter(tag => tag[0] === 'p')).toEqual([
      ['p', BOB],
      ['p', ALICE],
    ])
  })

  it('adds a root a-tag when replying to an addressable event', () => {
    const article = event({ id: ROOT, pubkey: ALICE, kind: 30023, tags: [['d', 'my-post']] })
    expect(buildReplyTags(article, { authorPubkey: ME })).toEqual([
      ['e', ROOT, '', 'root', ALICE],
      ['a', `30023:${ALICE}:my-post`, '', 'root'],
      ['p', ALICE],
    ])
  })

  it('rejects a parent whose id is not hex', () => {
    expect(() => buildReplyTags(event({ id: 'nope' }))).toThrow(TypeError)
  })
})

describe('replyContext', () => {
  it('describes the position a reply will occupy', () => {
    const parent = event({ id: MID, pubkey: BOB, tags: [['e', ROOT, '', 'root'], ['p', ALICE]] })
    expect(replyContext(parent)).toEqual({ rootId: ROOT, replyToId: MID, mentionedPubkeys: [BOB, ALICE] })
  })

  it('roots the thread at a top-level parent', () => {
    expect(replyContext(event({ id: ROOT, pubkey: ALICE }))).toEqual({
      rootId: ROOT,
      replyToId: ROOT,
      mentionedPubkeys: [ALICE],
    })
  })
})

describe('buildReply', () => {
  it('produces a kind-1 template with the thread tags first', () => {
    const parent = event({ id: ROOT, pubkey: ALICE })
    const template = buildReply('nice', parent, { authorPubkey: ME, createdAt: 123, tags: [['t', 'nostr']] })
    expect(template).toEqual({
      kind: 1,
      created_at: 123,
      content: 'nice',
      tags: [
        ['e', ROOT, '', 'root', ALICE],
        ['p', ALICE],
        ['t', 'nostr'],
      ],
    })
  })
})

describe('buildThreadTree', () => {
  const root = event({ id: ROOT, created_at: 100 })
  const first = event({ id: MID, created_at: 200, tags: [['e', ROOT, '', 'root']] })
  const second = event({ id: LEAF, created_at: 150, tags: [['e', ROOT, '', 'root']] })
  const nested = event({
    id: QUOTED,
    created_at: 300,
    tags: [
      ['e', ROOT, '', 'root'],
      ['e', MID, '', 'reply'],
    ],
  })

  it('nests replies under their parent and orders siblings oldest first', () => {
    const tree = buildThreadTree([nested, first, root, second])
    expect(tree).toHaveLength(1)
    expect(tree[0]?.event.id).toBe(ROOT)
    expect(tree[0]?.children.map(child => child.event.id)).toEqual([LEAF, MID])
    expect(tree[0]?.children[1]?.children.map(child => child.event.id)).toEqual([QUOTED])
    expect(flattenThread(tree).map(node => [node.event.id, node.depth])).toEqual([
      [ROOT, 0],
      [LEAF, 1],
      [MID, 1],
      [QUOTED, 2],
    ])
  })

  it('deduplicates events delivered by more than one relay', () => {
    expect(flattenThread(buildThreadTree([root, first, { ...first }]))).toHaveLength(2)
  })

  it('keeps a reply whose parent was not fetched as its own root', () => {
    const tree = buildThreadTree([nested, first])
    expect(tree.map(node => node.event.id)).toEqual([MID])
    expect(tree[0]?.children.map(child => child.event.id)).toEqual([QUOTED])
  })

  it('breaks a reply cycle instead of recursing forever', () => {
    const a = event({ id: ROOT, created_at: 10, tags: [['e', MID]] })
    const b = event({ id: MID, created_at: 20, tags: [['e', ROOT]] })
    const flat = flattenThread(buildThreadTree([a, b]))
    expect(flat.map(node => node.event.id).sort()).toEqual([MID, ROOT].sort())
    expect(flat).toHaveLength(2)
  })
})

/** A reply has to tag the people IT names, not only the people the parent named. */
describe('buildReply tags what the reply itself says', () => {
  const NOSTRICH = 'f27341f6cf1e7abdf894372246332f58fe79c9925d489fe597218017314adfd3'
  const NOSTRICH_NPUB = 'npub17fe5rak0reatm7y5xu3yvve0trl8njvjt4yflevhyxqpwv22mlfs3wnzuc'
  const parentOf = (author: string, tags: string[][] = []): NostrEvent =>
    ({
      id: 'd71d89f8b1421fae6d9144f79c9fb2548b9265ad7b6b0be1c3eb125e018e5a06',
      pubkey: author,
      created_at: 1_787_000_000,
      kind: 1,
      tags,
      content: 'parent',
      sig: '00',
    }) as NostrEvent

  const pTags = (template: { tags: string[][] }): string[] =>
    template.tags.filter(tag => tag[0] === 'p').map(tag => tag[1] ?? '')

  it('p-tags an account named in the reply body', () => {
    const reply = buildReply(`try nostr:${NOSTRICH_NPUB} works pretty well`, parentOf(ALICE))
    expect(pTags(reply)).toContain(NOSTRICH)
  })

  it('still tags the person being answered, first', () => {
    const reply = buildReply(`nostr:${NOSTRICH_NPUB} agreed`, parentOf(ALICE))
    expect(pTags(reply)[0]).toBe(ALICE)
    expect(pTags(reply)).toContain(NOSTRICH)
  })

  it('does not tag the same person twice when the reply names the parent author', () => {
    const alicePubkey = ALICE
    const npub = npubEncode(alicePubkey)
    const reply = buildReply(`nostr:${npub} yes`, parentOf(alicePubkey))
    expect(pTags(reply).filter(pubkey => pubkey === alicePubkey)).toHaveLength(1)
  })

  it('never tags the author replying, even when they name themselves', () => {
    const npub = npubEncode(ME)
    const reply = buildReply(`nostr:${npub} talking to myself`, parentOf(ALICE), { authorPubkey: ME })
    expect(pTags(reply)).not.toContain(ME)
  })

  it('keeps a deliberate mention when the thread has filled the p-tag ceiling', () => {
    // Inherited participants used to come first and could push the named account off.
    const crowd = Array.from({ length: 40 }, (_, index) =>
      `${index.toString(16).padStart(2, '0')}${'a'.repeat(62)}`,
    )
    const parent = parentOf(ALICE, crowd.map(pubkey => ['p', pubkey]))
    const reply = buildReply(`nostr:${NOSTRICH_NPUB} last word`, parent, { maxPubkeys: 8 })
    expect(pTags(reply)).toContain(NOSTRICH)
  })

  it('writes a t tag for a hashtag typed into a reply', () => {
    const reply = buildReply('agreed #bitcoin', parentOf(ALICE))
    expect(reply.tags).toContainEqual(['t', 'bitcoin'])
  })

  it('leaves an ordinary reply exactly as it was', () => {
    const reply = buildReply('no mentions here', parentOf(ALICE))
    expect(reply.tags.filter(tag => tag[0] === 't')).toHaveLength(0)
    expect(pTags(reply)).toEqual([ALICE])
  })
})
