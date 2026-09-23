/** Versioned URL for a file in public/. */
const VERSION = process.env.NEXT_PUBLIC_ASSET_VERSION ?? 'dev'

export function asset(path: string): string {
  return `${path}?v=${VERSION}`
}
