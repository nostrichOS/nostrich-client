import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The rule was fixed and the spam kept arriving. */
const source = readFileSync(join(__dirname, 'thin-mentions.ts'), 'utf8')
const rule = readFileSync(join(__dirname, '..', '..', '..', 'packages', 'nostr', 'src', 'thin-account.ts'), 'utf8')

describe('stored verdicts are versioned', () => {
  it('stamps the rule that decided them', () => {
    expect(source).toContain('const RULE_VERSION =')
    expect(source).toContain('rule: RULE_VERSION, verdicts: store')
  })

  it('discards verdicts from a different rule', () => {
    expect(source).toContain("held.rule !== RULE_VERSION) return {}")
  })

  it('discards the UNVERSIONED shape, which is every verdict from the old rule', () => {
    expect(source).toContain("typeof held.rule !== 'number'")
  })

  it('has been bumped past its first value', () => {
    /* v1 is the unversioned era. */
    expect(source).toContain('const RULE_VERSION = 3')
  })
})

describe('the rule the version refers to', () => {
  it('no longer spares an account for having a picture', () => {
    expect(rule).not.toContain('if (evidence.hasPicture) return false')
  })

  it('still spares a VERIFIED nip05', () => {
    // The one claim somebody else's DNS has to agree with, so it cannot be minted in bulk.
    expect(rule).toContain('if (evidence.nip05Verified) return false')
  })

  it('condemns the reported accounts: a picture, no nip05, a handful of notes, no replies', () => {
    expect(rule).toContain('evidence.rootNotes <= MIN_ROOT_NOTES || evidence.replies <= MIN_REPLIES')
  })
})

describe('the rule lives in ONE place', () => {
  it('the judging pass no longer has its own picture shortcut', () => {
    /* This was the whole reason the fix appeared not to work. */
    expect(source).not.toContain("(profile?.picture ?? '').trim() !== ''")
  })

  it('keeps the nip05 escape hatch, which is a different thing', () => {
    // Verified, not claimed, and short-circuiting here saves a counting query.
    expect(source).toContain('await nip05Passes(pubkey, profile?.nip05)')
  })

  it('passes hasPicture: false, so the field cannot spare anybody by accident', () => {
    expect(source).toContain('isThinAccount({ hasPicture: false, nip05Verified: false, following, ...counts })')
  })

  it('leaves following UNDEFINED rather than zero when the contacts query failed', () => {
    /* The line between this rule and hiding a real person's mentions over a timeout. */
    expect(source).toContain('const following = contacts === undefined')
    expect(source).toContain('? undefined')
  })
})
