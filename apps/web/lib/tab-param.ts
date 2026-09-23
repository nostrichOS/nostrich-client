'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/** A tab, addressable. */
export function useTabParam<T extends string>(
  values: readonly T[],
  fallback: T,
  key = 'tab',
): [T, (next: T) => void] {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const raw = params.get(key)
  // An unknown value falls back rather than rendering nothing: a stale or hand-edited.
  const active = values.includes(raw as T) ? (raw as T) : fallback

  const set = useCallback(
    (next: T): void => {
      const query = new URLSearchParams(params.toString())
      if (next === fallback) query.delete(key)
      else query.set(key, next)
      const search = query.toString()
      router.replace(search === '' ? pathname : `${pathname}?${search}`, { scroll: false })
    },
    [params, router, pathname, fallback, key],
  )

  return [active, set]
}
