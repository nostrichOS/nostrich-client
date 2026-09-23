import NextLink from 'next/link'
import { usePathname as useNextPathname, useRouter as useNextRouter, useSearchParams } from 'next/navigation'
import type { LinkProps, Router } from './index'

/** Next App Router binding. */
export function Link({
  href,
  children,
  className,
  accessibilityLabel,
  onPress,
  ...rest
}: LinkProps): React.ReactNode {
  return (
    <NextLink
      href={href}
      className={className}
      aria-label={accessibilityLabel}
      onClick={onPress}
      prefetch={false}
      {...rest}
    >
      {children}
    </NextLink>
  )
}

export function useRouter(): Router {
  const router = useNextRouter()
  return {
    push: (href: string) => router.push(href),
    replace: (href: string) => router.replace(href),
    back: () => router.back(),
  }
}

export function usePathname(): string {
  return useNextPathname()
}

export function useSearchParam(key: string): string | null {
  return useSearchParams().get(key)
}
