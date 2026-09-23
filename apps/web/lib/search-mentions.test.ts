import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { mentionAt } from '../components/MentionPicker'

/** "@ on search bars, just like the composer." The same detector and the same picker. */
const rail = readFileSync(join(__dirname, '..', 'components', 'RightRail.tsx'), 'utf8')
const explore = readFileSync(join(__dirname, '..', 'components', 'SearchScreen.tsx'), 'utf8')
const picker = readFileSync(join(__dirname, '..', 'components', 'MentionPicker.tsx'), 'utf8')
const hook = readFileSync(join(__dirname, 'search-mentions.ts'), 'utf8')

describe('the detector is the composer’s', () => {
  it('finds a bare @ at the end of a query', () => {
    expect(mentionAt('@', 1)).toEqual({ term: '', start: 0, end: 1 })
  })

  it('finds a partial handle mid-sentence', () => {
    const q = mentionAt('bitcoin @ali', 12)
    expect(q?.term).toBe('ali')
  })

  it('ignores an @ inside a word, so an email is not a mention', () => {
    expect(mentionAt('me@example.com', 14)).toBeUndefined()
  })

  it('ignores an @ the caret has moved away from', () => {
    expect(mentionAt('@alice and more', 15)).toBeUndefined()
  })
})

describe('both search bars have it', () => {
  it('the right column', () => {
    expect(rail).toContain('useSearchMentions()')
    expect(rail).toContain('<MentionPicker')
  })

  it('the explore page', () => {
    expect(explore).toContain('useSearchMentions()')
    expect(explore).toContain('<MentionPicker')
  })

  it('recomputes on caret moves, not only on typing', () => {
    // Arrows, a click and undo never fire onChange, and a list anchored to stale state.
    for (const source of [rail, explore]) {
      expect(source).toContain('onKeyUp={e => mentions.sync(e.currentTarget)}')
      expect(source).toContain('onClick={e => mentions.sync(e.currentTarget)}')
    }
  })

  it('never shows the people list and the recent-searches list at once', () => {
    // They are anchored to the same corner of the same field.
    expect(explore).toContain("recentOpen && term.trim() === '' && mentions.query === undefined")
  })
})

describe('the keyboard works in an input, not only a textarea', () => {
  it('checks the field the picker belongs to', () => {
    // It required `document.activeElement` to BE a textarea, which made arrows and Enter.
    expect(picker).toContain("field != null ? focused !== field : focused?.tagName !== 'TEXTAREA'")
  })

  it('keeps the field in the handler’s dependencies', () => {
    // Otherwise it closes over the first render's null ref and the check never matches.
    expect(picker).toContain('}, [candidates, active, commit, field])')
  })
})

describe('a pick goes to the person', () => {
  it('navigates rather than writing into the box', () => {
    expect(hook).toContain('router.push(profileHref(npubOf(pubkey)))')
  })

  it('closes the list first, so it cannot linger over the next page', () => {
    expect(hook).toContain('setQuery(undefined)\n      router.push(')
  })
})
