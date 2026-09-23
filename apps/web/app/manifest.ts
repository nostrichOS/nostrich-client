import type { MetadataRoute } from 'next'

import { asset } from '../lib/assets'

/** The web app manifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nostrich',
    short_name: 'Nostrich',
    description:
      'A Nostr client. Your keys, your posts, your relays, read and write the open social network from anywhere.',
    /* `id` pins the app's identity independently of `start_url`. */
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    /* White, matching the light `themeColor` in `layout.tsx`. */
    background_color: '#ffffff',
    theme_color: '#ffffff',
    orientation: 'any',
    categories: ['social'],
    icons: [
      /* TWO PURPOSES, and both are needed. */
      { src: asset('/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: asset('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: asset('/icon-maskable-192.png'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: asset('/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
