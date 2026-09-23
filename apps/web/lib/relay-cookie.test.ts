import { describe, expect, it } from 'vitest'

import { parseRelayCookie, sameRelayList, serializeRelayCookie } from './relay-cookie'

/** WHOSE LIST IS IN THE COOKIE, AND MAY WE REPLACE. */

describe('parseRelayCookie', () => {
  it('reads a list this app imported', () => {
    const raw = serializeRelayCookie(['wss://a.example'], 'imported')
    expect(parseRelayCookie(raw)).toEqual({ urls: ['wss://a.example'], src: 'imported' })
  })

  it('reads a list the reader edited', () => {
    const raw = serializeRelayCookie(['wss://a.example'], 'edited')
    expect(parseRelayCookie(raw)?.src).toBe('edited')
  })

  it('treats the ORIGINAL bare-array cookie as edited', () => {
    // Every reader who used this app before the format changed has one.
    expect(parseRelayCookie(JSON.stringify(['wss://a.example', 'wss://b.example']))).toEqual({
      urls: ['wss://a.example', 'wss://b.example'],
      src: 'edited',
    })
  })

  it('treats an unrecognised source as edited', () => {
    // Same rule, for a payload written by a future version or tampered with by hand.
    expect(parseRelayCookie('{"urls":["wss://a.example"],"src":"whatever"}')?.src).toBe('edited')
  })

  it('drops entries that are not strings', () => {
    expect(parseRelayCookie('{"urls":["wss://a.example",7,null],"src":"imported"}')).toEqual({
      urls: ['wss://a.example'],
      src: 'imported',
    })
  })

  it('returns null for an empty list', () => {
    // An empty list is not a choice, and treating it as one would leave the reader.
    expect(parseRelayCookie('[]')).toBeNull()
    expect(parseRelayCookie('{"urls":[],"src":"edited"}')).toBeNull()
  })

  it('returns null rather than throwing on a corrupt cookie', () => {
    expect(parseRelayCookie('not json')).toBeNull()
    expect(parseRelayCookie('"a string"')).toBeNull()
    expect(parseRelayCookie('null')).toBeNull()
  })

  it('round-trips what it writes', () => {
    const urls = ['wss://a.example', 'wss://b.example']
    expect(parseRelayCookie(serializeRelayCookie(urls, 'imported'))).toEqual({ urls, src: 'imported' })
  })
})

describe('sameRelayList', () => {
  it('ignores order', () => {
    // Only used to decide whether to offer a republish.
    expect(sameRelayList(['wss://a', 'wss://b'], ['wss://b', 'wss://a'])).toBe(true)
  })

  it('notices an addition and a removal', () => {
    expect(sameRelayList(['wss://a'], ['wss://a', 'wss://b'])).toBe(false)
    expect(sameRelayList(['wss://a', 'wss://b'], ['wss://a'])).toBe(false)
  })
})

describe('an explicit read + write is a decision', () => {
  /** `both` used to be omitted because it is the default. */
  it('survives the round trip', () => {
    const raw = serializeRelayCookie(['wss://a.example'], 'edited', { 'wss://a.example': 'both' })
    expect(parseRelayCookie(raw)?.policies).toEqual({ 'wss://a.example': 'both' })
  })

  it('keeps read-only and write-only too', () => {
    const urls = ['wss://a.example', 'wss://b.example']
    const raw = serializeRelayCookie(urls, 'edited', {
      'wss://a.example': 'read',
      'wss://b.example': 'write',
    })
    expect(parseRelayCookie(raw)?.policies).toEqual({
      'wss://a.example': 'read',
      'wss://b.example': 'write',
    })
  })

  it('still drops a policy for a relay that is not in the list', () => {
    // A hand-edited cookie must not carry a decision about a relay the reader cannot see.
    const raw = serializeRelayCookie(['wss://a.example'], 'edited', { 'wss://gone.example': 'read' })
    expect(parseRelayCookie(raw)?.policies).toBeUndefined()
  })
})
