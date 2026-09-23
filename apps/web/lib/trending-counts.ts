import type { NoteCounts } from '@nostrich/app'

/** What a trending card's numbers actually are, from three sources that each know part. */
export function mergeTrendingCounts(
  index: ReadonlyMap<string, NoteCounts>,
  zapped: ReadonlyMap<string, NoteCounts>,
  filled: ReadonlyMap<string, NoteCounts>,
  /** The reader's OWN actions newer than the index build, added ON TOP of the max. */
  own?: (id: string) => { likes: number; reposts: number; replies: number },
): Map<string, NoteCounts> {
  const merged = new Map<string, NoteCounts>(filled)
  for (const [id, count] of index) {
    /* PER-FIELD MAX, not the index wholesale. */
    const live = merged.get(id)
    const localSats = Math.max(zapped.get(id)?.zapSats ?? 0, live?.zapSats ?? 0)
    /* Sparse in, sparse out: a field neither source mentions stays absent rather. */
    const field = (a: number | undefined, b: number | undefined): { present: boolean; value: number } =>
      a === undefined && b === undefined
        ? { present: false, value: 0 }
        : { present: true, value: Math.max(a ?? 0, b ?? 0) }
    const replies = field(count.replies, live?.replies)
    const likes = field(count.likes, live?.likes)
    const reposts = field(count.reposts, live?.reposts)
    const zapCount = field(count.zapCount, live?.zapCount)
    const mine = own?.(id) ?? { likes: 0, reposts: 0, replies: 0 }
    merged.set(id, {
      ...count,
      ...(replies.present || mine.replies > 0 ? { replies: replies.value + mine.replies } : {}),
      ...(likes.present || mine.likes > 0 ? { likes: likes.value + mine.likes } : {}),
      ...(reposts.present || mine.reposts > 0 ? { reposts: reposts.value + mine.reposts } : {}),
      ...(zapCount.present ? { zapCount: zapCount.value } : {}),
      ...(count.zapSats !== undefined || localSats > 0
        ? { zapSats: Math.max(count.zapSats ?? 0, localSats) }
        : {}),
    })
  }
  return merged
}
