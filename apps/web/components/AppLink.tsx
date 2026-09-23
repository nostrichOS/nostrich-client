'use client'

import NextLink from 'next/link'
import type { ComponentProps } from 'react'

/** A link that does NOT prefetch the page behind. */
export function Link(props: ComponentProps<typeof NextLink>): React.ReactNode {
  return <NextLink prefetch={false} {...props} />
}
