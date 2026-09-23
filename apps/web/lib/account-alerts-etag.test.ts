import { describe, expect, it } from 'vitest'

/** Which p-tagged events may light the dot on an account that is NOT in front. */
/** `count` outright, `ask` the relays who wrote the note, or `drop`. */
const decide = (
  tags: string[][],
  ours: ReadonlySet<string>,
  asked: ReadonlyMap<string, string | null> = new Map(),
  me = 'me',
): 'count' | 'ask' | 'drop' => {
  const targets = tags.filter(tag => tag[0] === 'e' && typeof tag[1] === 'string').map(tag => tag[1] as string)
  if (targets.length === 0) return 'count'
  if (targets.some(id => ours.has(id) || asked.get(id) === me)) return 'count'
  return targets.every(id => asked.has(id)) ? 'drop' : 'ask'
}

const MINE = new Set(['mine-1', 'mine-2'])

describe('what may light a background account dot', () => {
  it('counts a mention, which has no e-tag and is addressed to us', () => {
    expect(decide([['p', 'me']], MINE)).toBe('count')
  })

  it('counts a reply to OUR note', () => {
    expect(decide([['e', 'mine-1'], ['p', 'me']], MINE)).toBe('count')
  })

  it('counts a deep reply whose root is theirs but whose parent is ours', () => {
    // NIP-10 puts several e-tags on a threaded reply.
    expect(decide([['e', 'their-root'], ['e', 'mine-2'], ['p', 'me']], MINE)).toBe('count')
  })

  it('ignores a malformed e-tag rather than treating it as a match', () => {
    expect(decide([['e'], ['p', 'me']], MINE)).toBe('count')
  })

  it('ASKS about a reply whose parent the cache has never heard of', () => {
    // The reported bug: on a fresh page load the cache is empty for an account.
    expect(decide([['e', 'unknown-note'], ['p', 'me']], new Set())).toBe('ask')
  })

  it('counts it once the lookup says that note is ours', () => {
    const asked = new Map([['unknown-note', 'me']])
    expect(decide([['e', 'unknown-note'], ['p', 'me']], new Set(), asked)).toBe('count')
  })

  it('REFUSES a reply to somebody else that carries our p-tag down the thread', () => {
    // The case the e-tag rule exists for: our note was quoted, and a stranger replied.
    const asked = new Map([['someone-elses-note', null]])
    expect(decide([['e', 'someone-elses-note'], ['p', 'me']], MINE, asked)).toBe('drop')
  })

  it('never asks twice about the same note', () => {
    const asked = new Map([['their-root', null], ['their-reply', null]])
    expect(decide([['e', 'their-root'], ['e', 'their-reply'], ['p', 'me']], new Set(), asked)).toBe('drop')
  })

  it('still asks while only SOME of the parents have been looked up', () => {
    const asked = new Map<string, string | null>([['their-root', null]])
    expect(decide([['e', 'their-root'], ['e', 'not-yet'], ['p', 'me']], new Set(), asked)).toBe('ask')
  })
})
