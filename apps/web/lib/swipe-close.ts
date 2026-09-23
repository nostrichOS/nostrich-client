/** Whether a finger's travel across the screen means "close this drawer". */

/** How far a finger must travel LEFT before this counts as a dismissal. */
export const CLOSE_DISTANCE = 48

/** How straight it has to be: sideways travel at least twice the vertical. */
export const CLOSE_STRAIGHTNESS = 2

/** @param dx Horizontal travel, negative when the finger moved left. */
export function closesDrawer(dx: number, dy: number): boolean {
  /* Leftward only. */
  if (dx >= -CLOSE_DISTANCE) return false
  return Math.abs(dy) * CLOSE_STRAIGHTNESS <= Math.abs(dx)
}
