import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** THE SIGNER IS NOT ALLOWED IN FRONT OF THE BOOKMARKS LIST. */

const SOURCE = readFileSync(join(import.meta.dirname, 'bookmarks.ts'), 'utf8')

function loadBookmarksBody(): string {
  const start = SOURCE.indexOf('async function loadBookmarks(')
  expect(start).toBeGreaterThan(-1)
  // Up to the decrypt, which is the first thing that legitimately depends on the fetch.
  const end = SOURCE.indexOf('nip44Decrypt', start)
  return SOURCE.slice(start, end === -1 ? start + 2000 : end)
}

describe('loadBookmarks', () => {
  it('asks the relays and the signer at the same time', () => {
    const body = loadBookmarksBody()
    expect(body).toContain('Promise.all')
    // Both calls inside the one await, rather than an await apiece.
    const concurrent = body.slice(body.indexOf('Promise.all'))
    expect(concurrent).toContain('probeEncryption')
    expect(concurrent).toContain('BOOKMARK_LIST_KIND')
  })

  it('never awaits the probe on its own before the list', () => {
    const body = loadBookmarksBody()
    expect(body).not.toMatch(/const\s+canEncrypt\s*=\s*await\s+probeEncryption/)
  })

  it('gives every id filter its own limit', () => {
    // A relay applies its own default to a filter with no limit, and that default.
    expect(SOURCE).toContain('{ ids: chunk, limit: chunk.length }')
  })
})
