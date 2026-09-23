'use client'

import { useEffect, useRef, useState } from 'react'

import { isAudioOnly, rememberAudioOnly } from '../lib/audio-only'
import { useScrolling } from '../lib/scrolling'
import { prefersReducedMotion } from '../lib/theme'
import { TimelineAudio } from './TimelineAudio'

/** A video in the timeline: plays itself when it scrolls into view, silent until asked. */

/** Only one video makes sound, and only one plays, anywhere on the page. */
let playing: HTMLVideoElement | null = null

/** How far past the edge of the screen a clip must be before it is stopped. */
const OUT_OF_SIGHT_PX = 200

function claim(node: HTMLVideoElement): void {
  if (playing !== null && playing !== node) {
    playing.pause()
    // Muted again on the way out, so scrolling back to it does not surprise the reader.
    playing.muted = true
  }
  playing = node
}

function release(node: HTMLVideoElement): void {
  if (playing === node) playing = null
}

export function TimelineVideo({
  src,
  railHeight,
  maxHeight,
  still,
}: {
  src: string
  /** Never start on its own. */
  still?: boolean
  /** Set when the clip is a cell in the media rail rather than the column's full width. */
  railHeight?: number
  /** The tallest this clip may draw, in pixels. */
  maxHeight?: number
}): React.ReactNode {
  /** 32rem, the timeline's own ceiling, unless the caller asked for a smaller box. */
  const cap = maxHeight ?? 512
  const ref = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [started, setStarted] = useState(false)
  /** A "video" with no picture. */
  const [soundOnly, setSoundOnly] = useState(() => isAudioOnly(src))
  /** The clip's own shape, once the container has told us. */
  const [ratio, setRatio] = useState(0)
  /** The control bar is handed back only once the page is still. */
  const scrolling = useScrolling()
  /** The reader has asked for the control bar. */
  const [wanted, setWanted] = useState(false)
  /** The clip is far enough past the edge of the screen that nothing about it is visible. */
  const [offScreen, setOffScreen] = useState(false)
  /** Whether the clip is actually running, tracked from the element's own events. */
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (node === null) return
    const on = (): void => {
      setPlaying(true)
      // Back in view AND running.
      setOffScreen(false)
    }
    const off = (): void => setPlaying(false)
    node.addEventListener('play', on)
    node.addEventListener('playing', on)
    node.addEventListener('pause', off)
    node.addEventListener('ended', off)
    return () => {
      node.removeEventListener('play', on)
      node.removeEventListener('playing', on)
      node.removeEventListener('pause', off)
      node.removeEventListener('ended', off)
    }
  }, [])

  useEffect(() => {
    const node = ref.current
    if (node === null || soundOnly) return
    const check = (): void => {
      if (node.videoWidth === 0 && node.videoHeight === 0) {
        rememberAudioOnly(src)
        setSoundOnly(true)
        return
      }
      if (node.videoHeight > 0) setRatio(node.videoWidth / node.videoHeight)
    }
    node.addEventListener('loadedmetadata', check)
    if (node.readyState >= 1) check()
    return () => node.removeEventListener('loadedmetadata', check)
  }, [src, soundOnly])

  useEffect(() => {
    const node = ref.current
    if (node === null || typeof IntersectionObserver === 'undefined') return

    // Set as a property, not just the JSX attribute.
    node.muted = true

    // Someone who asked their OS to reduce motion did not ask for a self-starting video.
    if (still === true || prefersReducedMotion()) return

    /** TWO BOUNDARIES, because starting and stopping are not the same question. */
    const start = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting !== true) return
        claim(node)
        // Rejects when the browser declines.
        void node.play().then(
          () => setStarted(true),
          () => undefined,
        )
      },
      { threshold: 0.5 },
    )

    const stop = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting !== false) return
        setOffScreen(true)
        node.pause()
        release(node)
      },
      { rootMargin: `${OUT_OF_SIGHT_PX}px 0px`, threshold: 0 },
    )

    start.observe(node)
    stop.observe(node)
    return () => {
      start.disconnect()
      stop.disconnect()
      node.pause()
      release(node)
    }
  }, [still])

  const toggleMuted = (): void => {
    const node = ref.current
    if (node === null) return
    const next = !node.muted
    // Unmuting is a user gesture, so this is the moment the browser will also allow sound.
    if (!next) claim(node)
    node.muted = next
    setMuted(next)
    if (!next && node.paused) void node.play().catch(() => undefined)
  }

  /* No picture, so no video element. */
  if (soundOnly) return <TimelineAudio src={src} />

  return (
    <span className={`relative block ${railHeight === undefined ? 'mt-2' : 'h-full'}`}>
      <video
        ref={ref}
        src={src}
        /** Everything the browser will let us take out of its own control bar. */
        controlsList="nodownload noremoteplayback"
        /* A TAP OPENS THE CONTROLS, IT DOES NOT OPEN THE NOTE. */
        onClick={clickEvent => {
          clickEvent.preventDefault()
          clickEvent.stopPropagation()
          setWanted(true)
        }}
        // Desktop only, and free: `onMouseEnter` does not fire from a touch.
        onMouseEnter={() => setWanted(true)}
        onMouseLeave={() => setWanted(false)}
        // `playsInline` is load-bearing on iOS: without it Safari takes any playing video.
        playsInline
        muted
        loop
        /** CONTROLS APPEAR WHEN THE READER ASKS FOR THEM. */
        controls={wanted || (!playing && !offScreen)}
        preload="metadata"
        /* `pointer-events-none` while the page moves, for the other half of the same problem. */
        className={`timeline-video ${scrolling ? 'pointer-events-none ' : ''}${
          railHeight === undefined
            ? 'w-full rounded-md border border-border bg-bg-inset'
            : 'size-full rounded-md border border-border bg-black object-cover'
        }`}
        /* A PORTRAIT clip is narrowed to its own shape, not centred inside a full-width box. */
        /* The ceiling is INLINE rather than a `max-h-*` class, because the width rule below. */
        {...(railHeight !== undefined
          ? { style: { height: railHeight } }
          : {
              style: {
                maxHeight: cap,
                // A PORTRAIT clip is narrowed to its own shape.
                ...(ratio > 0 ? { width: `min(100%, ${Math.round(cap * ratio)}px)` } : {}),
              },
            })}
      />

      {/* Shown only while muted and only once it is actually playing. */}
      {/* THE ONLY MUTE CONTROL. */}
      {started ? (
        <button
          type="button"
          onClick={toggleMuted}
          aria-label={muted ? 'Unmute video' : 'Mute video'}
          className="timeline-video-mute absolute left-2 top-2 flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
        >
          <span className="material-symbols-outlined text-[20px]!" aria-hidden="true">
            {muted ? 'volume_off' : 'volume_up'}
          </span>
        </button>
      ) : null}
    </span>
  )
}
