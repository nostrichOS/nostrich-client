import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** THE DOT MUST WATCH EVERYTHING THE PAGE DRAWS. */
const watch = readFileSync(join(__dirname, 'account-alerts.ts'), 'utf8')

describe('what the background-account dot subscribes to', () => {
  it('asks for NIP-22 comments, not only kind-1 replies', () => {
    // another client writes every reply to a note as a kind 1111.
    expect(watch).toContain('kinds: [KINDS.shortNote, KINDS.comment]')
  })

  it('gives replies their own filter so reactions cannot starve them', () => {
    // `limit` is applied PER FILTER, and reactions outnumber replies by an order.
    expect(watch).toContain('kinds: [KINDS.repost, KINDS.reaction]')
  })

  it('asks for both ways of being paid', () => {
    // A lightning receipt and an ecash nutzap, exactly as `zapReceiptFilter` does.
    expect(watch).toContain('kinds: [ZAP_RECEIPT, NUTZAP_KIND]')
    expect(watch).toContain('event.kind === ZAP_RECEIPT || event.kind === NUTZAP_KIND')
  })

  it('still asks for gift wraps without a window', () => {
    // NIP-59 randomises wrap timestamps by up to two days, so a `since` drops real mail.
    expect(watch).toContain("{ kinds: [GIFT_WRAP], '#p': watching, limit: 60 }")
  })
})

describe('how it judges what arrives', () => {
  it('uses the notifications page’s own classifier for notes', () => {
    // Not a second copy of the rule.
    expect(watch).toContain('noteNotificationKind(event, pubkey, ownIds(pubkey), threadMentionsEnabledFor(pubkey))')
  })

  it('reads the thread-mention preference of the WATCHED account', () => {
    // A preference belongs to an account.
    expect(watch).toContain('threadMentionsEnabledFor(pubkey)')
    expect(watch).not.toContain('threadMentionsEnabled()')
  })

  it('counts a quote, whose target is a `q` tag and not an `e` tag', () => {
    expect(watch).toContain("tag[0] === 'e' || tag[0] === 'q'")
  })

  it('re-judges a deferred event with the same rule that deferred it', () => {
    expect(watch).toContain('if (recount(event, pubkey)) countNote(event, pubkey)')
  })
})
