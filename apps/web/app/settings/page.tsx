import { Suspense } from 'react'

import { SettingsScreen } from '../../components/SettingsScreen'

export const metadata = { title: 'Settings' }

export default function SettingsPage(): React.ReactNode {
  // The active tab is read from the URL, so this reads useSearchParams.
  return (
    <Suspense fallback={null}>
      <SettingsScreen />
    </Suspense>
  )
}
