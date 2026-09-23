'use client'

import type { ReactionMark as Mark } from '../lib/reactions'

/** One reaction, drawn the same way everywhere it appears. */
export function ReactionMark({ mark }: { mark: Mark }): React.ReactNode {
  if (mark.url === undefined) return <span>{mark.display}</span>
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
    <img
      src={mark.url}
      alt={mark.display}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="inline-block size-[1.15em] translate-y-[0.15em] object-contain"
    />
  )
}
