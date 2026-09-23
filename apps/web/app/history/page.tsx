import { Suspense } from 'react'

import { HistoryScreen } from '../../components/HistoryScreen'

export const metadata = { title: 'History' }

export default function HistoryPage(): React.ReactNode {
  // The active tab is read from the URL, so this reads useSearchParams.
  return (
    <Suspense fallback={null}>
      <HistoryScreen />
    </Suspense>
  )
}
