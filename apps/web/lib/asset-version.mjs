import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** A cache-busting token derived from the CONTENTS of public/, computed once at build. */
export function assetVersion(publicDir) {
  const hash = createHash('sha256')
  const walk = dir => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      // Path as well as bytes: a rename with identical contents is still a change worth.
      // busting, and hashing bytes alone would miss.
      hash.update(entry)
      hash.update(readFileSync(full))
    }
  }
  try {
    walk(publicDir)
  } catch {
    // No public dir yet (fresh checkout, or a build that runs before assets are copied).
    // A stable fallback is correct here.
    return 'dev'
  }
  return hash.digest('hex').slice(0, 8)
}
