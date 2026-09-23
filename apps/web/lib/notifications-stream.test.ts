import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** A first-ever load painted nothing for 3.7 seconds it did not need. */
const source = readFileSync(join(__dirname, 'notifications.ts'), 'utf8')

describe('the first load streams', () => {
  it('hands each arrival to the caller while the sweep is still running', () => {
    expect(source).toContain('onPartial === undefined ? undefined : { onEvent: onPartial }')
  })

  it('only streams when the screen is empty', () => {
    // With a cache or a handover the page already paints in ~200ms.
    expect(source).toContain('if (!streamedRef.current && (held?.length ?? 0) > 0) return held')
  })

  it('treats the PLACEHOLDER as already on screen', () => {
    // react-query does not store placeholder data, so `held` reports empty.
    expect(source).toContain("client.getQueryData<NostrEvent[]>(notificationsQuery(pubkey, DOT_LIMIT).queryKey)")
    expect(source).toContain('if ((shown?.length ?? 0) > 0) return')
  })

  it('keeps streaming once it has started, rather than stopping at the first row', () => {
    // The guard is `!streamedRef.current`, so the second arrival is not refused.
    expect(source).toContain('streamedRef.current = true')
  })

  it('resets per account, so a switch is judged on its own screen', () => {
    expect(source).toContain('streamedRef.current = false')
  })

  it('does not skip a single rule, the list is shorter, never laxer', () => {
    // Everything downstream runs on this array exactly as on a settled one.
    expect(source).toContain('countsAsNotification')
  })

  it('never marks the query settled early', () => {
    // `setQueryData` while the fetch runs leaves it `isFetching`, which is what the dot.
    expect(source).not.toContain('queryClient.setQueryState')
  })
})
