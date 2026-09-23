import type { MetadataRoute } from 'next'

/** The public pages, for crawlers. */
/** Same source as `layout.tsx`'s `metadataBase`. */
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nostrich.org'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const pages: { path: string; priority: number }[] = [
    { path: '', priority: 1 },
    { path: '/explore', priority: 0.8 },
    { path: '/articles', priority: 0.7 },
    { path: '/login', priority: 0.4 },
  ]
  return pages.map(page => ({
    url: `${appUrl}${page.path}`,
    lastModified: now,
    changeFrequency: 'daily' as const,
    priority: page.priority,
  }))
}
