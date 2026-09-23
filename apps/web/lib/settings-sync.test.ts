import { beforeEach, describe, expect, it } from 'vitest'

import { adoptSettings, buildSettingsPayload, parseSettingsPayload } from './settings-sync'
import { scopedRecord, setActiveScope, writeScoped, applyScoped } from './scope'
import { BADGE_KEY, FONT_KEY } from './settings-keys'

/** The merge, which is the only part of this that can silently lose somebody's settings. */

const ALICE = 'a'.repeat(64)

beforeEach(() => {
  localStorage.clear()
  setActiveScope(ALICE)
})

describe('adopting what another device published', () => {
  it('takes a newer value', () => {
    applyScoped(BADGE_KEY, '{"enabled":false}', 100)
    adoptSettings({ badge: { v: '{"enabled":true}', at: 200 } })
    expect(scopedRecord(BADGE_KEY)?.v).toBe('{"enabled":true}')
    // With the ORIGINAL timestamp: this device did not just decide anything.
    expect(scopedRecord(BADGE_KEY)?.at).toBe(200)
  })

  it('leaves an older one alone', () => {
    applyScoped(BADGE_KEY, '{"enabled":true}', 300)
    adoptSettings({ badge: { v: '{"enabled":false}', at: 200 } })
    expect(scopedRecord(BADGE_KEY)?.v).toBe('{"enabled":true}')
  })

  it('takes a value this device has never had an opinion about', () => {
    adoptSettings({ fontSize: { v: 'large', at: 5 } })
    expect(scopedRecord(FONT_KEY)?.v).toBe('large')
  })

  it('beats a value adopted from the pre-account key, which is stamped zero', () => {
    localStorage.setItem(FONT_KEY, 'default')
    localStorage.setItem(
      'nostrich.accounts',
      JSON.stringify({ accounts: [{ kind: 'readonly', pubkey: ALICE }], active: ALICE }),
    )
    adoptSettings({ fontSize: { v: 'large', at: 10 } })
    expect(scopedRecord(FONT_KEY)?.v).toBe('large')
  })

  it('ignores junk in our slot rather than throwing', () => {
    expect(() => adoptSettings({ fontSize: 'not-an-entry', badge: null })).not.toThrow()
    expect(scopedRecord(FONT_KEY)).toBeUndefined()
  })
})

describe('what gets published', () => {
  it('carries this device’s values', () => {
    writeScoped(FONT_KEY, 'largest')
    const payload = buildSettingsPayload({})
    expect((payload['fontSize'] as { v: string }).v).toBe('largest')
  })

  it('keeps fields a newer build stored that this one does not understand', () => {
    writeScoped(FONT_KEY, 'largest')
    const payload = buildSettingsPayload({ somethingNew: { v: 'x', at: 9 } })
    expect(payload['somethingNew']).toEqual({ v: 'x', at: 9 })
  })

  it('does not publish an older local value over a newer stored one', () => {
    applyScoped(FONT_KEY, 'default', 100)
    const payload = buildSettingsPayload({ fontSize: { v: 'large', at: 500 } })
    expect(payload['fontSize']).toEqual({ v: 'large', at: 500 })
  })

  it('says nothing about a setting this device has never touched', () => {
    expect(buildSettingsPayload({})['fontSize']).toBeUndefined()
  })
})

describe('parseSettingsPayload', () => {
  it('refuses an array, which would otherwise be written back as the whole record', () => {
    expect(parseSettingsPayload('[1,2,3]')).toEqual({})
  })

  it('refuses garbage', () => {
    expect(parseSettingsPayload('not json')).toEqual({})
  })
})
