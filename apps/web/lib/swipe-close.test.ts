import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CLOSE_DISTANCE, CLOSE_STRAIGHTNESS, closesDrawer } from './swipe-close'

/** Swiping the phone's menu shut. */
describe('closesDrawer', () => {
  it('closes on a clean leftward swipe', () => {
    expect(closesDrawer(-120, 0)).toBe(true)
  })

  it('does nothing for a tap', () => {
    // A tap is a touchend too, with a delta of roughly nothing.
    expect(closesDrawer(0, 0)).toBe(false)
    expect(closesDrawer(-2, 1)).toBe(false)
  })

  it('ignores a RIGHTWARD swipe, however far', () => {
    /* The direction that OPENS. */
    expect(closesDrawer(300, 0)).toBe(false)
    expect(closesDrawer(48, 0)).toBe(false)
  })

  it('needs the full distance, and treats the threshold itself as too short', () => {
    expect(closesDrawer(-(CLOSE_DISTANCE - 1), 0)).toBe(false)
    expect(closesDrawer(-CLOSE_DISTANCE, 0)).toBe(false)
    expect(closesDrawer(-(CLOSE_DISTANCE + 1), 0)).toBe(true)
  })

  describe('a scroll is not a dismissal', () => {
    it('ignores a straight vertical drag', () => {
      expect(closesDrawer(0, -400)).toBe(false)
      expect(closesDrawer(0, 400)).toBe(false)
    })

    it('ignores a scroll that wandered sideways', () => {
      // The real shape of a thumb dragging down a list of ten rows: mostly vertical.
      expect(closesDrawer(-60, 300)).toBe(false)
      expect(closesDrawer(-90, 200)).toBe(false)
    })

    it('holds the line exactly where the straightness rule puts it', () => {
      const dx = -100
      // Vertical travel of half the horizontal is the limit, and is allowed.
      expect(closesDrawer(dx, 50)).toBe(true)
      expect(closesDrawer(dx, -50)).toBe(true)
      // A pixel more of vertical and it is a scroll.
      expect(closesDrawer(dx, 51)).toBe(false)
      expect(closesDrawer(dx, -51)).toBe(false)
      expect(Math.abs(dx) / CLOSE_STRAIGHTNESS).toBe(50)
    })

    it('a long diagonal does not qualify just by being long', () => {
      // Far past the distance threshold in both axes, and still mostly a scroll.
      expect(closesDrawer(-200, 300)).toBe(false)
    })
  })

  it('keeps the thresholds the drawer was tuned to', () => {
    // The distance and the straightness are a pair: loosen either and the menu becomes.
    expect(CLOSE_DISTANCE).toBe(48)
    expect(CLOSE_STRAIGHTNESS).toBe(2)
  })
})

describe('the drawer listens for it', () => {
  const drawer = readFileSync(join(__dirname, '..', 'components', 'MobileDrawer.tsx'), 'utf8')

  it('is wired to the panel', () => {
    expect(drawer).toContain('onTouchStart={onTouchStart}')
    expect(drawer).toContain('onTouchEnd={onTouchEnd}')
    expect(drawer).toContain('if (closesDrawer(touch.clientX - started.x, touch.clientY - started.y)) onClose()')
  })

  it('abandons a multi-touch rather than measuring one finger of it', () => {
    expect(drawer).toContain('if (event.touches.length !== 1)')
  })

  it('clears the origin when the OS takes the gesture', () => {
    // A notification shade or an incoming call cancels the touch.
    expect(drawer).toContain('onTouchCancel')
  })

  it('is touch only, so a desktop text-selection drag cannot dismiss it', () => {
    // This same component opens at full width in the deck, where a mouse is the input.
    expect(drawer).not.toContain('onPointerDown')
    expect(drawer).not.toContain('onMouseDown')
  })
})
