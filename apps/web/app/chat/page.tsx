import { Suspense } from 'react'

import { ChatScreen } from '../../components/ChatScreen'

export const metadata = { title: 'Chat' }

export default function ChatPage(): React.ReactNode {
  // useSearchParams needs a Suspense boundary in the App Router: the open conversation.
  return (
    <Suspense fallback={null}>
      <ChatScreen />
    </Suspense>
  )
}
