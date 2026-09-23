import type { Metadata, Viewport } from 'next'
import { Poppins } from 'next/font/google'

import { Providers } from '../components/Providers'
import { AppShell } from '../components/AppShell'
import { ServiceWorker } from '../components/ServiceWorker'
import { StaleBuildRescue } from '../components/StaleBuildRescue'
import { SCROLL_TOP_SCRIPT } from '../lib/scroll'
import { BADGE_BOOTSTRAP_SCRIPT } from '../lib/badge-color'
import { FONT_BOOTSTRAP_SCRIPT } from '../lib/font-size'
import { asset } from '../lib/assets'
import './globals.css'

// Dot access, not bracket: Next inlines NEXT_PUBLIC_* by literal text substitution.
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nostrich.org'

/** The brand typeface, matched to the wordmark. */
const brand = Poppins({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-poppins',
  display: 'swap',
})

/** Said in four places. */
const SITE_DESCRIPTION =
  'Nostrich is a new, 100% free, and best-in-class Nostr client for web, iOS, Android, Zapstore, and Mac. Your content. Your feed. Your experience.'

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: 'Nostrich',
    template: '%s · Nostrich',
  },
  description: SITE_DESCRIPTION,
  applicationName: 'Nostrich',
  // The SVG is the primary icon.
  icons: {
    icon: [
      /** `favicon.svg`, not `logo.svg`: same mark, darker ground. */
      { url: asset('/favicon.svg'), type: 'image/svg+xml' },
      { url: asset('/favicon-96.png'), sizes: '96x96', type: 'image/png' },
      { url: asset('/favicon-32.png'), sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: asset('/apple-touch-icon.png'), sizes: '180x180' }],
  },
  openGraph: {
    title: 'Nostrich',
    description: SITE_DESCRIPTION,
    url: appUrl,
    siteName: 'Nostrich',
    type: 'website',
    images: [
      {
        // A LITERAL path, not asset().
        url: '/nostrich-og.png',
        width: 3200,
        height: 1800,
        alt: 'Nostrich, a Nostr client for web, iOS, Android and Mac.',
      },
    ],
  },
  /** Twitter reads its own tags before falling back to Open Graph. */
  twitter: {
    card: 'summary_large_image',
    title: 'Nostrich',
    description: SITE_DESCRIPTION,
    images: ['/nostrich-og.png'],
  },
}

export const viewport: Viewport = {
  /** `viewport-fit=cover`. */
  viewportFit: 'cover',
  /** One palette, so one colour: the page ground. */
themeColor: '#ffffff',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The bootstrap script below edits this element's class list before React hydrates.
    <html lang="en" suppressHydrationWarning className={brand.variable}>
      <head>
        {/* Material Symbols, the icon set the ported X layout uses. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
        />
      {/* STRUCTURED DATA. It was added to earn a thumbnail beside the search result. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': 'Organization',
                  '@id': `${appUrl}#organization`,
                  name: 'Nostrich',
                  url: appUrl,
                  logo: {
                    '@type': 'ImageObject',
                    url: `${appUrl}/icon-1024.png`,
                    width: 1024,
                    height: 1024,
                  },
                },
                {
                  '@type': 'WebSite',
                  '@id': `${appUrl}#website`,
                  name: 'Nostrich',
                  url: appUrl,
                  publisher: { '@id': `${appUrl}#organization` },
                },
                {
                  '@type': 'SoftwareApplication',
                  name: 'Nostrich',
                  url: appUrl,
                  applicationCategory: 'SocialNetworkingApplication',
                  operatingSystem: 'Web',
                  image: `${appUrl}/icon-1024.png`,
                  description: SITE_DESCRIPTION,
                  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
                },
              ],
            }),
          }}
        />
      </head>
      <body className="min-h-dvh bg-bg text-text">
        {/* First thing in the body and deliberately blocking: it runs before the browser. */}
        {/* Same reasoning as the theme script: applied before paint, or the reader watches. */}
        <script dangerouslySetInnerHTML={{ __html: FONT_BOOTSTRAP_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: BADGE_BOOTSTRAP_SCRIPT }} />
        {/* Same reason it is here and not in an effect. */}
        <script dangerouslySetInnerHTML={{ __html: SCROLL_TOP_SCRIPT }} />

        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-accent"
        >
          Skip to content
        </a>

        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
        {/* Outside `Providers`: it needs no context and nothing renders. */}
        <ServiceWorker />
        {/* Beside it for the same reason: needs no context, renders nothing. */}
        <StaleBuildRescue />
      </body>
    </html>
  )
}
