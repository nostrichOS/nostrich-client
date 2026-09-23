'use client'

/** Why an attachment was refused, shown where the reader tried to attach. */
export function MediaGateNotice({ refusal }: { refusal: string | undefined }): React.ReactNode {
  if (refusal === undefined) return null
  return (
    <p
      role="status"
      className="mt-2 flex items-start gap-1.5 rounded-xl border border-warning-border bg-warning-surface px-3 py-2 text-[13px] leading-snug text-warning-text"
    >
      <span className="material-symbols-outlined mt-px text-[16px]!" aria-hidden="true">
        info
      </span>
      {refusal}
    </p>
  )
}
