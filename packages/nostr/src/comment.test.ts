import { describe, expect, it } from 'vitest'

import { KINDS } from './events'
import { buildComment, isComment, parentKind, parseThread, rootKind } from './thread'
import type { NostrEvent } from './types'

/** NIP-22 comments, which is how another client now writes every reply to a kind-1 note. */

const hex = (seed: string): string => seed.repeat(32).slice(0, 64)

const ROOT = hex('11')
const PARENT = hex('22')
const ALICE = hex('aa')
const BOB = hex('bb')
const ME = hex('dd')

const event = (overrides: Partial<NostrEvent> & Pick<NostrEvent, 'id'>): NostrEvent => ({
  pubkey: ALICE,
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: '',
  sig: '0'.repeat(128),
  ...overrides,
})

/** The exact shape measured on a live another client comment, minus the relay hints. */
const amethystComment = (overrides: { root?: string; parent?: string } = {}): NostrEvent =>
  event({
    id: hex('99'),
    kind: KINDS.comment,
    pubkey: BOB,
    tags: [
      ['E', overrides.root ?? ROOT, '', ALICE],
      ['K', '1'],
      ['P', ALICE, ''],
      ['e', overrides.parent ?? ROOT, '', ALICE],
      ['k', '1'],
      ['p', ALICE, ''],
      ['client', 'SomeClient'],
    ],
  })

describe('parseThread, NIP-22 comments', () => {
  it('places a comment written directly on a note', () => {
    expect(parseThread(amethystComment())).toEqual({
      rootId: ROOT,
      replyToId: ROOT,
      mentionedPubkeys: [ALICE],
    })
  })

  it('reads the root from E and the parent from e, not the other way round', () => {
    // The whole reason this branch exists: a NIP-10 reader sees one lowercase e-tag.
    const nested = amethystComment({ root: ROOT, parent: PARENT })
    expect(parseThread(nested).rootId).toBe(ROOT)
    expect(parseThread(nested).replyToId).toBe(PARENT)
  })

  it('falls back to the root when a client wrote no lowercase e', () => {
    const sparse = event({
      id: hex('98'),
      kind: KINDS.comment,
      tags: [['E', ROOT, '', ALICE], ['K', '1'], ['P', ALICE]],
    })
    // `mentionedPubkeys` stays lowercase-only: an uppercase `P` names where the thread.
    expect(parseThread(sparse)).toEqual({ rootId: ROOT, replyToId: ROOT, mentionedPubkeys: [] })
  })

  it('reports no id for a comment rooted on an article or a URL', () => {
    // An `A` or `I` root is an address, not an event id, and this app's threads are keyed.
    const onArticle = event({
      id: hex('97'),
      kind: KINDS.comment,
      tags: [['A', `30023:${ALICE}:my-post`, ''], ['K', '30023'], ['P', ALICE]],
    })
    expect(parseThread(onArticle).rootId).toBeUndefined()
    expect(parseThread(onArticle).replyToId).toBeUndefined()

    const onUrl = event({
      id: hex('96'),
      kind: KINDS.comment,
      tags: [['I', 'https://example.com/a'], ['K', 'web']],
    })
    expect(parseThread(onUrl).replyToId).toBeUndefined()
  })

  it('leaves NIP-10 parsing exactly as it was', () => {
    // The branch is keyed on uppercase tags, which no NIP-10 event carries.
    const marked = event({
      id: hex('95'),
      tags: [['e', ROOT, '', 'root'], ['e', PARENT, '', 'reply'], ['p', ALICE]],
    })
    expect(parseThread(marked)).toEqual({ rootId: ROOT, replyToId: PARENT, mentionedPubkeys: [ALICE] })

    const positional = event({ id: hex('94'), tags: [['e', ROOT], ['e', PARENT]] })
    expect(parseThread(positional)).toEqual({ rootId: ROOT, replyToId: PARENT, mentionedPubkeys: [] })

    const quoteOnly = event({ id: hex('93'), tags: [['e', ROOT, '', 'mention']] })
    expect(parseThread(quoteOnly).replyToId).toBeUndefined()
  })

  it('survives a malformed uppercase tag rather than throwing', () => {
    for (const tags of [[['E']], [['E', 'nonsense']], [['E', ROOT], ['e', 'nope']]]) {
      expect(() => parseThread(event({ id: hex('92'), kind: KINDS.comment, tags }))).not.toThrow()
    }
    // An E naming nothing usable leaves the comment unplaced rather than half-placed.
    expect(parseThread(event({ id: hex('92'), kind: KINDS.comment, tags: [['E', 'nonsense']] })).rootId).toBeUndefined()
  })
})

describe('kind helpers', () => {
  it('recognises a comment and the kinds it answers', () => {
    const comment = amethystComment()
    expect(isComment(comment)).toBe(true)
    expect(isComment(event({ id: ROOT }))).toBe(false)
    expect(parentKind(comment)).toBe(1)
    expect(rootKind(comment)).toBe(1)
    expect(parentKind(event({ id: ROOT }))).toBeUndefined()
  })

  it('reads a non-numeric K as no kind at all', () => {
    // NIP-22 allows `K` to name an external kind.
    const onUrl = event({ id: hex('91'), kind: KINDS.comment, tags: [['I', 'https://x.test'], ['K', 'web']] })
    expect(rootKind(onUrl)).toBeUndefined()
  })
})

describe('buildComment', () => {
  const note = event({ id: ROOT, pubkey: ALICE, kind: 1 })

  it('answers a root note with both scopes naming that note', () => {
    const built = buildComment('nice one', note, { authorPubkey: ME })
    expect(built.kind).toBe(1111)
    expect(built.content).toBe('nice one')
    expect(built.tags).toContainEqual(['E', ROOT, '', ALICE])
    expect(built.tags).toContainEqual(['K', '1'])
    expect(built.tags).toContainEqual(['e', ROOT, '', ALICE])
    expect(built.tags).toContainEqual(['k', '1'])
    expect(built.tags).toContainEqual(['p', ALICE, ''])
  })

  it('inherits the root scope when answering a comment', () => {
    // The point of inheriting rather than recomputing: this client may never have fetched.
    const parent = amethystComment({ root: ROOT, parent: ROOT })
    const built = buildComment('and another thing', parent)
    expect(built.tags).toContainEqual(['E', ROOT, '', ALICE])
    expect(built.tags).toContainEqual(['e', parent.id, '', BOB])
    expect(built.tags).toContainEqual(['k', String(KINDS.comment)])
    expect(parseThread(built)).toMatchObject({ rootId: ROOT, replyToId: parent.id })
  })

  it('round-trips through parseThread', () => {
    const built = buildComment('hello', note)
    expect(parseThread(built)).toMatchObject({ rootId: ROOT, replyToId: ROOT })
  })

  it('tags people named in the text, and never the author', () => {
    const built = buildComment(`hey nostr:${'npub1'}… and thanks`, note, { authorPubkey: ALICE })
    // Alice wrote the parent AND is composing: she must not be p-tagged into her own.
    expect(built.tags.filter(tag => tag[0] === 'p' && tag[1] === ALICE)).toHaveLength(0)
  })

  it('carries hashtags out of the body', () => {
    const built = buildComment('gm #bitcoin', note)
    expect(built.tags).toContainEqual(['t', 'bitcoin'])
  })

  it('uses an address for an addressable root', () => {
    const article = event({
      id: hex('88'),
      pubkey: ALICE,
      kind: 30023,
      tags: [['d', 'my-post']],
    })
    const built = buildComment('good read', article)
    expect(built.tags).toContainEqual(['A', `30023:${ALICE}:my-post`, ''])
    expect(built.tags).toContainEqual(['K', '30023'])
  })

  it('refuses a parent whose id is not hex', () => {
    expect(() => buildComment('x', event({ id: 'not-hex' }))).toThrow(TypeError)
  })
})
