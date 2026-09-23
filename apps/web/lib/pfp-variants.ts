/** The thumbnail widths our own image cache is willing to produce, in pixels. */
export const PFP_VARIANTS = [128, 384] as const

export type PfpVariant = (typeof PFP_VARIANTS)[number]

export function isPfpVariant(size: number): size is PfpVariant {
  return (PFP_VARIANTS as readonly number[]).includes(size)
}

/** The path a thumbnail is served. */
export function pfpVariantPath(variant: PfpVariant): string {
  return `/api/pfp/${variant}.webp`
}
