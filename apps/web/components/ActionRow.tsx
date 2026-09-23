'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PATHS, type ActionIconName, type NoteCounts } from '@nostrich/app'

import { alignCounts } from '../lib/fx/bearing'
import { formatCount } from '../lib/fx/count'
import { confetti, fire, crackle, tierFor } from '../lib/fx/engine'

/** Reply, repost, zap, like, bookmark. */

/** THE HOLD, in two numbers. */
const DEAD_MS = 140
const RAMP_MS = 520

/** Past this much movement the press is a scroll, not a zap. */
const SLOP_PX = 10

export interface ActionRowProps {
  counts?: NoteCounts
  liked?: boolean
  reposted?: boolean
  zapped?: boolean
  bookmarked?: boolean
  onReply?: () => void
  onLike?: () => void
  onRepost?: () => void
  onBookmark?: () => void
  /** A tap on the bolt: send the reader's default amount. */
  onZapTap?: () => Promise<number | undefined>
  /** A hold on the bolt: open the modal. */
  onZapMenu?: () => void
}

export function ActionRow({
  counts,
  liked = false,
  reposted = false,
  zapped = false,
  bookmarked = false,
  onReply,
  onLike,
  onRepost,
  onBookmark,
  onZapTap,
  onZapMenu,
}: ActionRowProps): React.ReactNode {
  const row = useRef<HTMLDivElement>(null)

  useEffect(() => {
    alignCounts(row.current)
  }, [counts?.replies, counts?.reposts, counts?.zapSats, counts?.likes])

  return (
    <div
      ref={row}
      className="action-row"
      /* THE ROW SWALLOWS ITS OWN PRESSES. */
      onClick={event => event.stopPropagation()}
    >
      <Action name="reply" label="Reply" count={counts?.replies} onPress={onReply} />
      <Action name="repost" label="Repost" count={counts?.reposts} on={reposted} onPress={onRepost} />
      <ZapAction sats={counts?.zapSats} zapped={zapped} onTap={onZapTap} onMenu={onZapMenu} />
      <Action name="like" label="Like" count={counts?.likes} on={liked} burst onPress={onLike} />
      <Action name="bookmark" label="Bookmark" on={bookmarked} onPress={onBookmark} />
    </div>
  )
}

function Action({
  name,
  label,
  count,
  on = false,
  burst = false,
  onPress,
}: {
  name: ActionIconName
  label: string
  count?: number
  on?: boolean
  /** Throws confetti on the way IN only, the way every client does. */
  burst?: boolean
  onPress?: () => void
}): React.ReactNode {
  const ico = useRef<HTMLSpanElement>(null)
  const num = useRef<HTMLSpanElement>(null)

  const press = (): void => {
    pulse(ico.current, 'is-popping')
    if (count !== undefined && count > 0) pulse(num.current, 'is-bumping')
    if (burst && !on) burstAt(ico.current)
    onPress?.()
  }

  return (
    <button
      type="button"
      className={`action action-${name}${on ? ' is-on' : ''}`}
      // The count belongs IN the label: a screen reader announcing "Like, 4" is useful.
      aria-label={count !== undefined && count > 0 ? `${label}, ${count}` : label}
      aria-pressed={onIsToggle(name) ? on : undefined}
      onClick={press}
      disabled={onPress === undefined}
    >
      <span ref={ico} className="action-ico">
        <Glyph name={name} />
      </span>
      {count !== undefined && count > 0 ? (
        <span ref={num} className="action-num">
          {formatCount(count)}
        </span>
      ) : null}
    </button>
  )
}

/** The bolt, which is the only one of the five with a gesture rather than a click. */
function ZapAction({
  sats,
  zapped,
  onTap,
  onMenu,
}: {
  sats?: number
  zapped: boolean
  onTap?: () => Promise<number | undefined>
  onMenu?: () => void
}): React.ReactNode {
  const button = useRef<HTMLButtonElement>(null)
  const ico = useRef<HTMLSpanElement>(null)
  const num = useRef<HTMLSpanElement>(null)
  const raf = useRef(0)
  const holding = useRef(false)
  const start = useRef(0)
  const origin = useRef({ x: 0, y: 0 })
  const opened = useRef(false)
  const [busy, setBusy] = useState(false)

  const reset = useCallback((): void => {
    holding.current = false
    cancelAnimationFrame(raf.current)
    const el = button.current
    if (el === null) return
    el.classList.remove('is-charging', 'is-brimming')
    el.style.setProperty('--charge', '0')
  }, [])

  useEffect(() => reset, [reset])

  const tick = useCallback((): void => {
    if (!holding.current) return
    const el = button.current
    if (el === null) return
    const held = performance.now() - start.current
    const charge = Math.max(0, Math.min(1, (held - DEAD_MS) / RAMP_MS))
    el.style.setProperty('--charge', charge.toFixed(3))

    if (charge >= 1) {
      el.classList.add('is-brimming')
      opened.current = true
      reset()
      vibrate(14)
      onMenu?.()
      return
    }
    // Roughly a third of frames: every frame is a wall of arcs, and none reads as charging.
    if (charge > 0 && Math.random() < 0.3) {
      const c = centreOf(ico.current)
      if (c !== undefined) crackle(c.x, c.y, charge)
    }
    raf.current = requestAnimationFrame(tick)
  }, [onMenu, reset])

  const begin = (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    if (holding.current || busy) return
    opened.current = false
    origin.current = { x: event.clientX, y: event.clientY }
    try {
      button.current?.setPointerCapture(event.pointerId)
    } catch {
      // Safari refuses capture for some pointer types.
    }
    holding.current = true
    start.current = performance.now()
    button.current?.classList.add('is-charging')
    raf.current = requestAnimationFrame(tick)
  }

  const end = (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    if (!holding.current) return
    reset()
    // The menu already took this press.
    if (opened.current) return
    void send()
  }

  const send = async (): Promise<void> => {
    if (onTap === undefined || busy) return
    setBusy(true)
    try {
      const amount = await onTap()
      if (amount === undefined) return
      const c = centreOf(ico.current)
      const tier = tierFor(amount)
      if (c !== undefined) fire(tier, c.x, c.y)
      pulse(ico.current, 'is-popping')
      pulse(num.current, 'is-bumping')
      strike(ico.current)
      vibrate(6 + 4 * tier)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      ref={button}
      type="button"
      className={`action action-zap${zapped ? ' is-on is-zapped' : ''}`}
      aria-label={sats !== undefined && sats > 0 ? `Zap, ${sats} sats` : 'Zap'}
      aria-pressed={zapped}
      aria-haspopup="dialog"
      onPointerDown={begin}
      onPointerUp={end}
      onPointerCancel={reset}
      onPointerMove={event => {
        if (!holding.current) return
        const dx = event.clientX - origin.current.x
        const dy = event.clientY - origin.current.y
        // A scroll that started here is not a zap.
        if (Math.hypot(dx, dy) > SLOP_PX) {
          opened.current = true
          reset()
        }
      }}
      // The browser would otherwise synthesise a click after pointerup and fire the zap.
      onClick={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        if (event.repeat || holding.current) return
        opened.current = false
        holding.current = true
        start.current = performance.now()
        button.current?.classList.add('is-charging')
        raf.current = requestAnimationFrame(tick)
      }}
      onKeyUp={event => {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        if (!holding.current) return
        reset()
        if (opened.current) return
        void send()
      }}
      disabled={onTap === undefined && onMenu === undefined}
    >
      <span ref={ico} className="action-ico">
        <Glyph name="zap" />
      </span>
      {sats !== undefined && sats > 0 ? (
        <span ref={num} className="action-num">
          {formatCount(sats)}
        </span>
      ) : null}
    </button>
  )
}

function Glyph({ name }: { name: ActionIconName }): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

/** Restart an animation that may already be running. */
function pulse(el: HTMLElement | null, cls: string): void {
  if (el === null) return
  el.classList.remove(cls)
  // Reading layout is what forces the restart.
  void el.offsetWidth
  el.classList.add(cls)
}

function centreOf(el: HTMLElement | null): { x: number; y: number } | undefined {
  if (el === null) return undefined
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function burstAt(el: HTMLElement | null): void {
  const c = centreOf(el)
  if (c !== undefined) confetti(c.x, c.y)
}

/** The card flashes when it is zapped. */
function strike(el: HTMLElement | null): void {
  const card = el?.closest('[data-note-card]')
  if (!(card instanceof HTMLElement)) return
  card.classList.remove('note-lit')
  void card.offsetWidth
  card.classList.add('note-lit')
  window.setTimeout(() => card.classList.remove('note-lit'), 450)
}

function vibrate(ms: number): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(ms)
  } catch {
    // Blocked by a permissions policy, or a browser that lies about having.
  }
}

/** Only the four with a state announce one. */
function onIsToggle(name: ActionIconName): boolean {
  return name !== 'reply'
}

