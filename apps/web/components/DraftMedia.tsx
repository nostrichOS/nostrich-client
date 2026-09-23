'use client'

import { useState } from 'react'

import { fitBox, useNaturalRatio } from '../lib/preview-fit'

import { DraftMediaRail } from './DraftMediaRail'

/** Media the draft carries, drawn as media and never as text. */
export function DraftMedia({
  urls,
  onRemove,
}: {
  urls: readonly string[]
  onRemove?: (url: string) => void
}): React.ReactNode {
  if (urls.length === 0) return null

  return (
    // Same rail the posted note uses, so what the author checks is the arrangement.
    <DraftMediaRail>
      {urls.map(url => (
        <Preview key={url} url={url} {...(onRemove === undefined ? {} : { onRemove })} />
      ))}
    </DraftMediaRail>
  )
}

/** One attachment, with something to look at while it arrives. */
function Preview({ url, onRemove }: { url: string; onRemove?: (url: string) => void }): React.ReactNode {
  const [loaded, setLoaded] = useState(false)
  const shape = useNaturalRatio()

  return (
    /* FULL WIDTH, not shrink-to-fit. */
    <div className="relative w-full">
      {loaded ? null : (
        <div
          aria-hidden="true"
          // 16/10 and a fixed width: a guess, but a stable one.
          className="h-56 w-full animate-pulse rounded-xl border border-border bg-bg-inset motion-reduce:animate-none"
        />
      )}
      {/* Sized to the picture, capped in height. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host. */}
      <img
        src={url}
        alt=""
        /** NOT `loading="lazy"`, and NOT hidden while it loads. */
        decoding="async"
        // Someone else's CDN.
        referrerPolicy="no-referrer"
        onLoad={event => {
          // The shape decides the box.
          shape.learn(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
          setLoaded(true)
        }}
        // A broken URL must not leave the skeleton pulsing forever.
        onError={() => setLoaded(true)}
        style={loaded ? fitBox(shape.ratio) : undefined}
        className={
          loaded
            ? /* The box is the picture's own shape, capped by width, see `fitBox`. */
              'w-full rounded-xl border border-border bg-bg-inset object-contain'
            : 'pointer-events-none absolute inset-0 h-full w-full opacity-0'
        }
      />

      {onRemove === undefined ? null : (
        <button
          type="button"
          onClick={() => onRemove(url)}
          aria-label="Remove"
          /* The dark circle every dismissible attachment in this app uses. */
          className="absolute right-2 top-2 flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/75"
        >
          <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
            close
          </span>
        </button>
      )}
    </div>
  )
}
