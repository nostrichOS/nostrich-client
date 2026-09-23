'use client'

/** The glyphs Material Symbols gets wrong for this app. */

/** Head and shoulders, drawn open at the bottom. */
export const PROFILE_PATH = 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'

/** Circular chat bubble with a tail. */
export const CHAT_BUBBLE_PATH =
  'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z'

/** `size` is the box, `weight` the stroke in 24-grid units. */
export function ChatBubbleIcon({
  size = 20,
  weight = 2.25,
}: {
  size?: number
  weight?: number
}): React.ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      width={size}
      height={size}
      className="shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={CHAT_BUBBLE_PATH} />
    </svg>
  )
}

/** The same bubble, with a + inside it: "start a conversation". */
export function NewChatIcon({
  size = 20,
  weight = 2.25,
}: {
  size?: number
  weight?: number
}): React.ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      width={size}
      height={size}
      className="shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={CHAT_BUBBLE_PATH} />
      <path d="M12 9.5v4M10 11.5h4" />
    </svg>
  )
}

/** The two looping arrows, the same path the action row's repost button draws. */
export { PATHS as ACTION_PATHS } from '@nostrich/app/src/components/icon-paths'
