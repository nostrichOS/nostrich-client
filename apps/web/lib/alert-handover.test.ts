import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The dot said something happened. */
const notifications = readFileSync(join(__dirname, 'notifications.ts'), 'utf8')
const alerts = readFileSync(join(__dirname, 'account-alerts.ts'), 'utf8')

describe('the nav dot', () => {
  it('no longer waits on isPending alone', () => {
    /* The regression was self-inflicted and invisible: the handover was written. */
    expect(notifications).not.toContain('if (query.isPending && newestKnownFor(pubkey) > floor)')
    expect(notifications).toContain('(query.isPending || query.isFetching) && newestKnownFor(pubkey) > floor')
  })

  it('applies the same rule to the wallet dot', () => {
    expect(notifications).toContain('(query.isPending || query.isFetching) && newestZapKnownFor(pubkey) > floor')
  })

  it('still clears itself, rather than latching', () => {
    // Both are compared against the same read marker as everything else, so opening.
    expect(notifications).toContain('newestKnownFor(pubkey) > floor')
  })
})

describe('the row itself', () => {
  it('the watch keeps the events, not only their timestamp', () => {
    expect(alerts).toContain('export function heldAlertEvents')
    expect(alerts).toContain('remember(pubkey, event)')
  })

  it('is bounded per account', () => {
    // It only ever holds what arrived while the reader was looking at somebody else.
    expect(alerts).toContain('const RECENT_PER_ACCOUNT = 30')
  })

  it('seeds the page with them, deduped against the disk cache', () => {
    expect(notifications).toContain('dedupeById([...heldAlertEvents(pubkey), ...heldNotifications(pubkey)])')
  })

  it('adds them to a cache that is already populated, instead of giving up', () => {
    // Revisiting an account in the same session leaves query data in place.
    expect(notifications).toContain('const known = new Set(existing.map(event => event.id))')
  })

  it('does NOT bypass the page’s own rules', () => {
    // A shortcut past the network, never past `countsAsNotification`.
    expect(notifications).toContain('countsAsNotification')
  })
})
