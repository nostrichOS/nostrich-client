'use client'

/** The vertical rail that ties a note to the one. */

/** Geometry of the note card's avatar column, mirrored here so the rail lines up. */
export const AVATAR_CENTER = 16 + 22
/** Where the rail starts: card padding + avatar height + a small gap. */
export const AVATAR_TOP = 12 + 44 + 4
/* `AVATAR_COLUMN`, the per-level indent step, is gone. */

export function Threaded({
  connected,
  children,
}: {
  connected: boolean
  children: React.ReactNode
}): React.ReactNode {
  return (
    <div className="relative">
      {connected ? (
        <span
          aria-hidden="true"
          /* `z-10` because the card next to this rail paints a background on hover. */
          /* ONE PIXEL, like every other rail in the app. */
          className="absolute z-10 w-px rounded-full bg-border"
          // AVATAR_TOP clears the avatar itself.

          // Half a pixel back from the centre so a 1px line straddles it: at `AVATAR_CENTER`.
          style={{ left: `${AVATAR_CENTER - 0.5}px`, top: `${AVATAR_TOP}px`, bottom: 0 }}
        />
      ) : null}
      {children}
    </div>
  )
}
