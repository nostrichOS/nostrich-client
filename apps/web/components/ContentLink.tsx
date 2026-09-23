'use client'

import { Link } from './AppLink'

import { linkKind } from '../lib/links'

/** The one anchor for a href that came out of user content. */
export function ContentLink({
  href,
  className,
  style,
  onClick,
  role,
  children,
}: {
  href: string
  className?: string
  /** For a link whose box is computed rather than classed. */
  style?: React.CSSProperties
  onClick?: (event: React.MouseEvent) => void
  /** For a link that is also a menu item. */
  role?: string
  children: React.ReactNode
}): React.ReactNode {
  const target = linkKind(href)

  // A scheme we will not link.
  if (target.kind === 'refused') {
    return (
      <span className={className} style={style}>
        {children}
      </span>
    )
  }

  if (target.kind === 'internal') {
    return (
      <Link href={target.href} className={className} style={style} onClick={onClick} role={role}>
        {children}
      </Link>
    )
  }

  return (
    <a
      href={target.href}
      target={target.target}
      rel={target.rel}
      className={className}
      style={style}
      onClick={onClick}
      role={role}
    >
      {children}
    </a>
  )
}
