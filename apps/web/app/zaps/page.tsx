import { Suspense } from 'react'

import { ZapsScreen } from '../../components/ZapsScreen'

export const metadata = { title: 'Wallet' }

export default function ZapsPage(): React.ReactNode {
  // The active tab is read from the URL, so this reads useSearchParams.
  return (
    <Suspense fallback={null}>
      <ZapsScreen />
    </Suspense>
  )
}
