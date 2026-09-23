/** How much a note was engaged with, as one number. */
export interface EngagementCounts {
  replies: number
  /** ALL amplifications. */
  reposts: number
  /** The subset of `reposts` that are quotes. */
  quotes: number
  reactions: number
  /** DISTINCT zappers. The heaviest weighted term, and the gate on the sats bonus. */
  zapCount: number
  /** TOTAL sats across every zap. */
  zapSats: number
}

/** Total-sats thresholds. */
const SATS_STEPS = [1, 10, 100, 500, 1_000, 5_000, 10_000] as const

/** The conviction bonus: 0 unless two distinct people zapped, then 0–7 by total sats. */
export function satsBonus(zapSats: number, zapCount: number): number {
  if (zapCount < 2) return 0
  let bonus = 0
  for (const step of SATS_STEPS) if (zapSats >= step) bonus += 1
  return bonus
}

export function engagementScore(counts: EngagementCounts): number {
  return (
    counts.zapCount * 3 +
    counts.reposts * 2 +
    counts.quotes +
    counts.replies * 2 +
    counts.reactions +
    satsBonus(counts.zapSats, counts.zapCount)
  )
}
