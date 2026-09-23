/** The action row's counts, formatted the way the reference does. */
export function formatCount(n: number): string {
  if (n < 1_000) return String(n)
  return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`
}
