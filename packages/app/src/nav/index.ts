/** The navigation seam, so shared components never import the host's router directly. */

export interface LinkProps {
  href: string
  children: React.ReactNode
  className?: string
  /** Accessibility label, when the link's content is an icon rather than text. */
  accessibilityLabel?: string
  /** Marks the current page for assistive tech and active styling. */
  'aria-current'?: 'page' | undefined
  onPress?: () => void
}

export interface Router {
  push: (href: string) => void
  replace: (href: string) => void
  back: () => void
}

export type { LinkProps as NavLinkProps }

export { Link, useRouter, usePathname, useSearchParam } from './impl'
