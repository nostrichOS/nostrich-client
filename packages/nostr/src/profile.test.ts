import { describe, expect, it } from 'vitest'

import { profileToTemplate } from './profile'
import type { Profile } from './types'

/** What a profile save is allowed to delete. */

const ME = 'a'.repeat(64)
const base: Profile = { pubkey: ME, updatedAt: 0 }
const contentOf = (template: { content: string }): Record<string, unknown> =>
  JSON.parse(template.content) as Record<string, unknown>

describe('fields the caller does not model', () => {
  it('survive a save', () => {
    const template = profileToTemplate(
      { ...base, name: 'me' },
      { preserve: { lud06: 'lnurl1dp68…', bot: true, birthday: { year: 1990 } } },
    )
    const content = contentOf(template)
    expect(content['lud06']).toBe('lnurl1dp68…')
    expect(content['bot']).toBe(true)
    expect(content['birthday']).toEqual({ year: 1990 })
    expect(content['name']).toBe('me')
  })

  it('survive even when the caller passes the key as undefined', () => {
    // The editor spreads conditionally, so an absent field arrives as undefined rather.
    const template = profileToTemplate({ ...base, lud06: undefined }, { preserve: { lud06: 'lnurl1' } })
    expect(contentOf(template)['lud06']).toBe('lnurl1')
  })
})

describe('fields the caller owns', () => {
  it('are replaced when given a value', () => {
    const template = profileToTemplate({ ...base, name: 'new' }, { preserve: { name: 'old' } })
    expect(contentOf(template)['name']).toBe('new')
  })

  it('are cleared when given an empty string, that is how a form says "now blank"', () => {
    const template = profileToTemplate({ ...base, website: '' }, { preserve: { website: 'https://old' } })
    expect(contentOf(template)['website']).toBeUndefined()
  })

  it('clears one field without touching the others', () => {
    const template = profileToTemplate(
      { ...base, name: 'me', website: '' },
      { preserve: { name: 'me', website: 'https://old', lud16: 'me@wallet', lud06: 'lnurl1' } },
    )
    const content = contentOf(template)
    expect(content['website']).toBeUndefined()
    expect(content['lud16']).toBe('me@wallet')
    expect(content['lud06']).toBe('lnurl1')
  })
})
