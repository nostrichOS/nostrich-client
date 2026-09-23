/** Placing a floating card under the thing it belongs to, and keeping it there. */

/** Gap between the card and the viewport edge. */
export const EDGE = 8
/** Gap between the anchor's bottom and the card's top. */
export const GAP = 8
/** A card never shrinks below this, even on a short viewport. */
export const MIN_HEIGHT = 180

export interface Placement {
  left: number
  top: number
  maxHeight: number
}

/** Where a card of `width` goes when hung below `rect`. */
export function placeBelow(
  rect: { left: number; bottom: number },
  width: number,
  viewportWidth: number,
  viewportHeight: number,
): Placement {
  return {
    // Clamped so a card anchored near the right edge does not hang off.
    left: Math.max(EDGE, Math.min(rect.left, viewportWidth - width - EDGE)),
    top: rect.bottom + GAP,
    maxHeight: Math.max(MIN_HEIGHT, viewportHeight - rect.bottom - 2 * EDGE),
  }
}

/** Whether the anchor is still somewhere a card can point. */
export function anchorVisible(
  rect: { top: number; bottom: number; left: number; right: number; width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  if (rect.width === 0 && rect.height === 0) return false
  return rect.bottom > 0 && rect.top < viewportHeight && rect.right > 0 && rect.left < viewportWidth
}
