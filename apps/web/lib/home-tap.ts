/** WHAT PRESSING HOME MEANS. */

/** What this press should do, given whether the reader is already looking at Home. */
export function homePressIntent(onHome: boolean): 'top' | 'return' {
  return onHome ? 'top' : 'return'
}
