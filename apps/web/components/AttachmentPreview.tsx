'use client'

import { fitBox, useNaturalRatio } from '../lib/preview-fit'

/** One attachment in a composer, in a box shaped like the thing inside. */
export function AttachmentPreview({
  item,
  cap,
  children,
}: {
  item: { preview: string; file: { type: string } }
  /** The tallest this preview may. */
  cap?: number
  children: React.ReactNode
}): React.ReactNode {
  const shape = useNaturalRatio()
  const box = fitBox(shape.ratio, cap)
  const frame = 'w-full rounded-xl border border-border bg-bg-inset object-contain'

  return (
    <div
      className="relative w-full"
      // The wrapper takes the same cap, so the overlay tracks the media and not the column.
      style={box === undefined ? undefined : { maxWidth: box.maxWidth }}
    >
      {item.file.type.startsWith('video/') ? (
        <video
          src={item.preview}
          muted
          // A clip announces its size with metadata, long before it can show a frame.
          onLoadedMetadata={event =>
            shape.learn(event.currentTarget.videoWidth, event.currentTarget.videoHeight)
          }
          style={box}
          className={frame}
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- local object URL */
        <img
          src={item.preview}
          alt=""
          onLoad={event =>
            shape.learn(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
          }
          style={box}
          className={frame}
        />
      )}
      {children}
    </div>
  )
}
