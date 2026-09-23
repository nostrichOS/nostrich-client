import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** A note the reader just published must be the first thing they see. */
const screen = readFileSync(join(__dirname, '..', 'components', 'FeedScreen.tsx'), 'utf8')

describe('own posts appear at the top', () => {
  it('puts this session’s own notes ahead of the ranking', () => {
    expect(screen).toContain('return [...mine, ...kept, ...feed.notes.filter(note => !known.has(note.id))]')
  })

  it('only top-level notes by the reader, only from this session', () => {
    // Not replies (they belong in their thread), not other people's, and not everything.
    expect(screen).toContain("if (event.kind !== KINDS.shortNote || isReply(event)) return")
    expect(screen).toContain('if (pubkey === undefined || event.pubkey !== pubkey) return')
  })

  it('re-derives when a new note lands', () => {
    expect(screen).toMatch(/justPublished\]\)/)
  })

  it('still de-duplicates against the ranked rows', () => {
    // A note that IS trending must appear once, in its ranked place or hoisted.
    expect(screen).toContain('const known = new Set([...kept, ...mine].map(note => note.id))')
  })
})
