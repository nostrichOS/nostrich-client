/** Who the "Who to follow" panel deals, as a pure function. */

/** Five, which is what the design asks for and what fits beside the panels above. */
export const SUGGESTIONS_SHOWN = 5

/** A small, fast, DETERMINISTIC generator. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The seed: this hour, and who is reading. */
function seedFor(hour: number, viewer: string | undefined): number {
  let seed = hour
  if (viewer === undefined) return seed
  // A cheap string hash.
  for (let i = 0; i < viewer.length; i += 1) seed = (Math.imul(seed, 31) + viewer.charCodeAt(i)) | 0
  return seed
}

/** Five accounts to suggest, drawn from the authors whose notes are trending. */
/** The full candidate list for this hour, in the order it will be handed out. */
export function orderSuggestions<T extends string>(
  /** The windows, in PREFERENCE order. */
  tiers: readonly (readonly T[])[],
  viewer: T | undefined,
  hour: number,
): T[] {
  const seen = new Set<string>()
  const out: T[] = []

  for (const [tier, authors] of tiers.entries()) {
    const candidates: T[] = []
    for (const author of authors) {
      if (author === viewer || seen.has(author)) continue
      seen.add(author)
      candidates.push(author)
    }

    /* Fisher–Yates, driven by the seeded generator so the order is a pure function. */
    const random = mulberry32(seedFor(hour + tier * 7919, viewer))
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      const swap = candidates[i] as T
      candidates[i] = candidates[j] as T
      candidates[j] = swap
    }

    out.push(...candidates)
  }

  return out
}

/** The five on screen, updated in place. */
export function reconcileSuggestions<T extends string>(
  previous: readonly T[],
  ordered: readonly T[],
  following: ReadonlySet<string>,
): T[] {
  const out: T[] = []
  const used = new Set<string>(previous.filter(person => !following.has(person)))
  let cursor = 0

  const next = (): T | undefined => {
    while (cursor < ordered.length) {
      const candidate = ordered[cursor] as T
      cursor += 1
      if (!following.has(candidate) && !used.has(candidate)) {
        used.add(candidate)
        return candidate
      }
    }
    return undefined
  }

  // Held slots keep their position.
  for (const person of previous) {
    if (!following.has(person)) {
      out.push(person)
      continue
    }
    const replacement = next()
    if (replacement !== undefined) out.push(replacement)
  }

  // First fill, or topping back up after the pool was too thin to replace something.
  while (out.length < SUGGESTIONS_SHOWN) {
    const candidate = next()
    if (candidate === undefined) break
    out.push(candidate)
  }

  return out
}

/** The whole thing in one call. */
export function pickSuggestions<T extends string>(
  tiers: readonly (readonly T[])[],
  viewer: T | undefined,
  hour: number,
  following: ReadonlySet<string> = new Set(),
): T[] {
  return reconcileSuggestions([], orderSuggestions(tiers, viewer, hour), following)
}
