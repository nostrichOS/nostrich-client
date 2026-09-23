import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** THE NOTE'S OWN PAGE SHOWS THE WHOLE NOTE. */

const WEB = join(import.meta.dirname, '..')

describe('note detail', () => {
  it('renders the focused note unfolded', () => {
    const thread = readFileSync(join(WEB, 'components', 'ThreadScreen.tsx'), 'utf8')
    // The NoteCard for the target, not the ArticleScreen above.
    const cards = thread
      .split('<NoteCard')
      .slice(1)
      .filter(part => part.includes('event={thread.target}'))
    expect(cards).toHaveLength(1)
    expect(cards[0]?.slice(0, 300)).toContain('unfolded')
  })

  it('leaves the ancestors and the replies folded', () => {
    const thread = readFileSync(join(WEB, 'components', 'ThreadScreen.tsx'), 'utf8')
    // Every other NoteCard in the thread renders context, not the note being read.
    const others = thread
      .split('<NoteCard')
      .slice(1)
      .filter(part => !part.slice(0, 300).includes('event={thread.target}'))
    for (const part of others) expect(part.slice(0, 260)).not.toContain('unfolded')
  })

  it('carries the prop through both cards to the content', () => {
    const app = join(WEB, '..', '..', 'packages', 'app', 'src', 'components')
    expect(readFileSync(join(WEB, 'components', 'NoteCard.tsx'), 'utf8')).toContain('unfolded')
    expect(readFileSync(join(app, 'NoteCard.tsx'), 'utf8')).toContain('unfolded: true')
    // The fold's starting state is the only thing the prop changes.
    expect(readFileSync(join(app, 'NoteContent.tsx'), 'utf8')).toContain(
      'useState(unfolded === true)',
    )
  })
})
