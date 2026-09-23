'use client'

import type { DraftMediaItem } from '../lib/draft-media'
import { PreviewDismiss } from './PreviewDismiss'
import { PreviewImage } from './NoteContent'
import { TimelineAudio } from './TimelineAudio'
import { TimelineVideo } from './TimelineVideo'

/** Pasted media URLs, drawn the way the posted note will draw them. */
export function DraftMediaUrls({
  items,
  onDismiss,
}: {
  items: readonly DraftMediaItem[]
  onDismiss: (url: string) => void
}): React.ReactNode {
  if (items.length === 0) return null
  return (
    <div className="mt-3 space-y-2">
      {items.map(item => (
        <div key={item.url} className="relative">
          {item.type === 'video' ? (
            <TimelineVideo src={item.url} />
          ) : item.type === 'audio' ? (
            <TimelineAudio src={item.url} />
          ) : (
            // No tags: a draft has none yet, so the box cannot know the picture's shape.
            <PreviewImage url={item.url} tags={[]} />
          )}
          <PreviewDismiss
            onDismiss={() => onDismiss(item.url)}
            label={`Remove ${item.type}`}
          />
        </div>
      ))}
    </div>
  )
}
