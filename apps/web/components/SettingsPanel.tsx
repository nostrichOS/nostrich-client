'use client'

import { SETTINGS_BODY, SETTINGS_TITLE } from '../lib/styles'

/** One setting, in its own surface. */
export function Panel({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <section className="rounded-xl border border-border p-4 sm:p-5">
      <h2 className={SETTINGS_TITLE}>{title}</h2>
      {/* Capped measure. */}
      <p className={`mt-1 max-w-[58ch] ${SETTINGS_BODY}`}>{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}
