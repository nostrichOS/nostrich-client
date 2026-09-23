import { Suspense } from 'react'
import { ProfileScreen } from '../../../components/ProfileScreen'

/** NO `metadata.title` here, deliberately. */

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }): React.ReactNode {
  return (
    <Suspense fallback={null}>
      <ProfileScreen params={params} />
    </Suspense>
  )
}
