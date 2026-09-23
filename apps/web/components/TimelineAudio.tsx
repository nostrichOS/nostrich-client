'use client'

import { useEffect, useRef, useState } from 'react'

import { ContentLink } from './ContentLink'

/** A track in the timeline. */

/** One track plays at a time, page-wide. */
let sounding: HTMLAudioElement | null = null

function claim(node: HTMLAudioElement): void {
  if (sounding !== null && sounding !== node) sounding.pause()
  sounding = node
}

function release(node: HTMLAudioElement): void {
  if (sounding === node) sounding = null
}

/** `m:ss`, or `h:mm:ss` once there is an hour to show. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const whole = Math.floor(seconds)
  const s = whole % 60
  const m = Math.floor(whole / 60) % 60
  const h = Math.floor(whole / 3600)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

export function TimelineAudio({ src }: { src: string }): React.ReactNode {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [duration, setDuration] = useState(Number.NaN)
  const [buffered, setBuffered] = useState(0)
  const [failed, setFailed] = useState(false)
  /** Held while the reader drags, so the thumb follows the finger and not the playhead. */
  const [scrubbing, setScrubbing] = useState<number | null>(null)

  useEffect(() => {
    const node = ref.current
    if (node === null) return

    const onTime = (): void => setAt(node.currentTime)
    const onMeta = (): void => setDuration(node.duration)
    const onPlay = (): void => {
      claim(node)
      setPlaying(true)
    }
    const onPause = (): void => setPlaying(false)
    const onEnded = (): void => {
      release(node)
      setPlaying(false)
      setAt(0)
    }
    const onProgress = (): void => {
      // The last buffered range is the one that matters: seeking backwards leaves.
      const ranges = node.buffered
      setBuffered(ranges.length === 0 ? 0 : ranges.end(ranges.length - 1))
    }
    const onError = (): void => setFailed(true)

    node.addEventListener('timeupdate', onTime)
    node.addEventListener('loadedmetadata', onMeta)
    node.addEventListener('durationchange', onMeta)
    node.addEventListener('play', onPlay)
    node.addEventListener('pause', onPause)
    node.addEventListener('ended', onEnded)
    node.addEventListener('progress', onProgress)
    node.addEventListener('error', onError)
    return () => {
      release(node)
      node.removeEventListener('timeupdate', onTime)
      node.removeEventListener('loadedmetadata', onMeta)
      node.removeEventListener('durationchange', onMeta)
      node.removeEventListener('play', onPlay)
      node.removeEventListener('pause', onPause)
      node.removeEventListener('ended', onEnded)
      node.removeEventListener('progress', onProgress)
      node.removeEventListener('error', onError)
    }
  }, [])

  const known = Number.isFinite(duration) && duration > 0
  const shown = scrubbing ?? at
  const played = known ? Math.min(100, (shown / duration) * 100) : 0
  const loaded = known ? Math.min(100, (buffered / duration) * 100) : 0

  const toggle = (): void => {
    const node = ref.current
    if (node === null) return
    if (node.paused) {
      claim(node)
      void node.play().catch(() => setFailed(true))
    } else {
      node.pause()
    }
  }

  const seek = (value: number): void => {
    const node = ref.current
    if (node === null || !known) return
    node.currentTime = value
    setAt(value)
  }

  /* A file that will not play is a link again. */
  if (failed) {
    return (
      <ContentLink
        href={src}
        className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-bg-inset px-3 py-2.5 text-sm text-text-muted hover:border-accent hover:text-accent"
      >
        <NoteIcon />
        Audio unavailable, open the file
      </ContentLink>
    )
  }

  return (
    <div className="relative mt-2 flex items-center gap-3 rounded-xl border border-border bg-bg-inset px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3">
      {/* `metadata`, not `auto`: the duration is worth a round trip, the file. */}
      <audio ref={ref} src={src} preload="metadata" aria-label="Audio attachment" />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        /* Ink, not accent. */
        className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-text text-bg shadow-sm transition-transform hover:scale-105 active:scale-95 sm:size-11"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      {/* ONE ROW, not two. */}
      <div className="relative flex h-4 min-w-0 flex-1 items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-border" />
        <div
          className="absolute left-0 h-1.5 rounded-full bg-text-faint/25"
          style={{ width: `${loaded}%` }}
          aria-hidden="true"
        />
        <div
          className="absolute left-0 h-1.5 rounded-full bg-text transition-[width] duration-150 ease-linear"
          style={{ width: `${played}%` }}
          aria-hidden="true"
        />
        {/* Always drawn, including before the first press. */}
        <div
          className="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full bg-text shadow-sm ring-2 ring-bg-inset"
          style={{ left: `${played}%` }}
          aria-hidden="true"
        />
        <input
          type="range"
          min={0}
          max={known ? duration : 0}
          step={0.1}
          value={shown}
          disabled={!known}
          onChange={event => setScrubbing(Number(event.target.value))}
          onPointerUp={() => {
            if (scrubbing !== null) seek(scrubbing)
            setScrubbing(null)
          }}
          onKeyUp={() => {
            if (scrubbing !== null) seek(scrubbing)
            setScrubbing(null)
          }}
          aria-label="Seek"
          className="audio-scrub absolute inset-x-0 h-4 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default"
        />
      </div>

      {/* Elapsed appears only once there is an elapsed to show. */}
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-faint">
        {playing || shown > 0 ? `${clock(shown)} / ` : ''}
        {known ? clock(duration) : '--:--'}
      </span>
    </div>
  )
}

function PlayIcon(): React.ReactNode {
  return (
    /* Centred by its own geometry, not by a nudge. */
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-6">
      <path d="M7 4.5v15l10-7.5z" />
    </svg>
  )
}

function PauseIcon(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-6">
      <path d="M7 4.5h3.2v15H7zM13.8 4.5H17v15h-3.2z" />
    </svg>
  )
}

function NoteIcon(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0">
      <path d="M20 3.5v11.2a3.3 3.3 0 1 1-2-3.03V7.2l-8 1.6v8.4a3.3 3.3 0 1 1-2-3.03V6.2l12-2.7Z" />
    </svg>
  )
}
