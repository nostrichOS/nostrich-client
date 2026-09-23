'use client'

import { useEffect, useRef, useState } from 'react'

/** A small emoji picker, hand-rolled rather than pulled from a package. */

const GROUPS: { name: string; emoji: string[] }[] = [
  {
    name: 'Smileys',
    emoji: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
      '😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐',
      '😐','😑','😶','😏','😒','🙄','😬','😮','😴','😪','😵','🤯','🥳','😎','🤓','🧐',
    ],
  },
  {
    name: 'Gestures',
    emoji: [
      '👍','👎','👌','🤌','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋',
      '🤚','🖐️','🖖','👋','🤝','🙏','✍️','💪','🦾','🫶','👏','🙌','👐','🤲','🫡','🤷',
    ],
  },
  {
    name: 'Hearts',
    emoji: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💯','🔥'],
  },
  {
    name: 'Nostr',
    emoji: ['⚡','🟣','🦩','🔑','🛡️','🌐','📡','🗝️','🧡','🚀','🫂','☕','🤙','₿','🍊','💜'],
  },
  {
    name: 'Objects',
    emoji: [
      '✅','❌','⭐','🌟','✨','🎉','🎊','🎁','📌','📍','🔗','📎','📝','📖','💡','🔔',
      '⏰','📅','🖼️','🎥','🎵','🎶','☀️','🌙','🌈','☁️','❄️','🌊','🌱','🍀','🐦','🦅',
    ],
  },
]

export function EmojiPicker({
  onPick,
  onClose,
  above = false,
  align = 'left',
}: {
  onPick: (emoji: string) => void
  onClose: () => void
  /** Opens upward instead of down. */
  above?: boolean
  /** Which edge it hangs. */
  align?: 'left' | 'right'
}): React.ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [group, setGroup] = useState(0)

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    // Deferred a tick: the click that opened this picker is still propagating.
    const timer = setTimeout(() => document.addEventListener('click', onClick), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const active = GROUPS[group] ?? GROUPS[0]

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji"
      // Opens DOWNWARD.
      /** A BOTTOM SHEET on a phone, an anchored popover from `sm` up. */
      className={`fixed inset-x-2 bottom-2 z-50 max-h-[70dvh] w-auto overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:max-h-none sm:rounded-lg ${
        above ? 'sm:bottom-full sm:mb-2' : 'sm:top-full sm:mt-2'
      } ${align === 'right' ? 'sm:right-0' : 'sm:left-0'} sm:w-[min(360px,calc(100vw-2rem))]`}
    >
      <div className="no-scrollbar flex overflow-x-auto border-b border-border">
        {GROUPS.map((item, index) => (
          <button
            key={item.name}
            type="button"
            onClick={() => setGroup(index)}
            // px-2 and flex-1: five group names at px-3 measured wider than the panel.
            className={`flex-1 shrink-0 px-2 py-2 text-xs font-semibold transition-colors ${
              index === group ? 'text-text' : 'text-text-faint hover:text-text-muted'
            }`}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto p-2">
        {active?.emoji.map(emoji => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            aria-label={emoji}
            className="flex size-8 items-center justify-center rounded-lg text-[20px] leading-none transition-colors hover:bg-bg-inset"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}
