import { Suspense } from 'react'

import { NotificationsScreen } from '../../components/NotificationsScreen'

export const metadata = { title: 'Notifications' }

export default function NotificationsPage(): React.ReactNode {
  // The active tab is read from the URL, so this reads useSearchParams.
  return (
    <Suspense fallback={null}>
      <NotificationsScreen />
    </Suspense>
  )
}
