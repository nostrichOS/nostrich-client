import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Emptying the Requests box must return the reader to their conversations. */
const screen = readFileSync(join(__dirname, '..', 'components', 'ChatScreen.tsx'), 'utf8')

describe('the requests box cannot strand the reader', () => {
  it('falls back to the inbox when the last request goes', () => {
    expect(screen).toContain("if (box === 'requests' && inbox.requests.length === 0) setBox('inbox')")
  })

  it('still hides the tab strip when there is nothing to request', () => {
    // The fallback exists BECAUSE the strip hides.
    expect(screen).toContain('{inbox.requests.length === 0 ? null : (')
  })

  it('watches the count, not the array identity', () => {
    // Keyed on `.length`, so a re-render that rebuilds an equally-empty array does.
    expect(screen).toContain('}, [box, inbox.requests.length])')
  })
})
