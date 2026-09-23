'use client'

/** The × on a composer preview. */
export function PreviewDismiss({
  onDismiss,
  label,
}: {
  onDismiss: () => void
  /** Said in the reader's terms. */
  label: string
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label={label}
      /* `z-10` because a card is frequently a link that fills its own box. */
      className="absolute right-2 top-2 z-10 flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/75"
    >
      <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
        close
      </span>
    </button>
  )
}
