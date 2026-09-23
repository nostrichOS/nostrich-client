import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Zaps must survive both halves of the cached-notifications design. */
const source = readFileSync(join(__dirname, 'notifications.ts'), 'utf8')

describe('cached notifications never lose a zap', () => {
  it('never windows the zap filters with `since`', () => {
    // Both call sites.
    expect(source).not.toContain('zapReceiptFilter(pubkey, since)')
    expect(source).toContain('zapReceiptFilter(pubkey),')
  })

  it('keeps receipts whole when trimming the cache to CACHE_EVENTS', () => {
    /* The cap must apply to `rest`, never to the receipts: they are few. */
    expect(source).toContain('const money = all.filter')
    expect(source).toContain('rest.sort(byTime).slice(0, CACHE_EVENTS)')
    /* Receipts get their own, much larger budget. */
    expect(source).toContain('money.sort(byTime).slice(0, CACHE_RECEIPTS)')
    expect(source).toContain('const CACHE_RECEIPTS = 120')
    // A receipt carries the whole zap request in `description`.
    expect(source).not.toContain('const CACHE_RECEIPTS = 400')
    expect(source).not.toContain('[...all].sort((a, b) => b.created_at - a.created_at).slice(0, CACHE_EVENTS)')
  })

  it('does not trade the delta away to repair an emptied cache', () => {
    /* An emptied cache repairs itself BECAUSE the zap filters are unwindowed. */
    expect(source).not.toContain('held.hasMoney')
  })

  it('still windows the high-volume kinds, or the delta would be pointless', () => {
    // The whole point of the delta survives: notes/reactions/reposts stay windowed.
    expect(source).toContain('notificationFilters(pubkey, since, noteLimit)')
  })
})
