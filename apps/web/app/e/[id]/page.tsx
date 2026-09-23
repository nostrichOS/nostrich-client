import { Suspense } from 'react'
import { ThreadScreen } from '../../../components/ThreadScreen'

export const metadata = {
  title: 'Note',
}

/** A thread is dynamic by definition. */
export default function NotePage({ params }: { params: Promise<{ id: string }> }): React.ReactNode {
  return (
    <Suspense fallback={null}>
      <ThreadScreen params={params} />
    </Suspense>
  )
}
