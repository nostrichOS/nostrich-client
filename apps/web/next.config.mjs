import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { assetVersion } from './lib/asset-version.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ASSET_VERSION = assetVersion(join(here, 'public'))

/** @type {import('next').NextConfig}. */
const nextConfig = {
  reactStrictMode: true,
  // The workspace packages ship raw TypeScript with no build step, so Next.
  // compile them itself.
  // @nostrich/app additionally ships React Native JSX, which only works once the alias.
  // below is in place.
  transpilePackages: [
    '@nostrich/nostr',
    '@nostrich/ui',
    '@nostrich/types',
    '@nostrich/api',
    '@nostrich/app',
    'react-native-web',
  ],
  // Note avatars and inline images come from arbitrary third-party hosts the user.
  // chose, so they are plain <img> tags.
  // entire web, and we would be proxying other people's media through our box , .
  // exactly the liability this project refuses to take.
  poweredByHeader: false,

  // Frozen at build time and read by components as `?v=…`.
  // why this is a content hash rather than a deploy timestamp.
  env: {
    NEXT_PUBLIC_ASSET_VERSION: ASSET_VERSION,
  },

  async headers() {
    return [
      {
        // EVERY page.
        // HTML, because the HTML is what names the current JS bundle.
        // front of this origin and will happily cache a 200 HTML response for hours.
        // otherwise, which is how users end up on an old UI that no amount of redeploying.
        // fixes.

        // `no-cache` for the BROWSER, `no-store` for the CDN.
        // jobs and only the CDN half was ever load-bearing.

        // `no-cache` does not mean "do not cache".
        // before reuse, so a 304 is a guarantee the bytes are identical and a changed bundle.
        // is still a miss.

        // What changes is bfcache.
        // in Chrome and Firefox, so restoring the tab is a full reload from zero.
        // hardest by exactly the readers with the least to spare: someone on iOS.
        // app-switches to a remote signer to approve a signature and comes back to find.
        // page rebuilt.

        // The earlier note here worried about `stale-while-revalidate` painting an old shell.
        // for a frame.
        // repo, so there is no path that serves these bytes without asking first.
        /* EVERY PAGE. */
        source: '/:path((?!api/).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
      {
        // Versioned static assets are the opposite case: their URL changes whenever.
        // bytes change, so they can be cached permanently and never revalidated.
        source: '/:file(logo.svg|icon-512.png|icon-1024.png|apple-touch-icon.png)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Next's own chunks are already content-hashed by the bundler.
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },

  webpack: config => {
    // The single line that makes one UI codebase work on five targets.
    // `import { View } from 'react-native'` in @nostrich/app resolves to react-native-web.
    // here, and to the real React Native under Metro.
    config.resolve.alias = {
      ...config.resolve.alias,
      'react-native$': 'react-native-web',
    }
    // React Native packages ship `.web.js` variants that must win over the native ones.
    // Without this the bundler picks the native file and pulls in Fabric internals.
    // do not exist in a browser.
    config.resolve.extensions = [
      '.web.tsx',
      '.web.ts',
      '.web.jsx',
      '.web.js',
      ...config.resolve.extensions,
    ]
    return config
  },
}

export default nextConfig
