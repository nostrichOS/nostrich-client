import { Suspense } from 'react'

import { FeedScreen } from '../components/FeedScreen'

/** The feed reads `?t=` and `?feed=` through useSearchParams, which Next 15 requires. */
export default function HomePage() {
  return (
    <Suspense fallback={<div className="h-96 rounded-xl border border-line bg-surface-raised" />}>
      <FeedScreen />
    </Suspense>
  )
}
