import Link from 'next/link'

import { BUTTON_PRIMARY, CARD } from '../lib/styles'

export default function NotFound() {
  return (
    <div className={`${CARD} space-y-3 px-5 py-6`}>
      <h1 className="text-lg font-semibold text-text">No such page</h1>
      <p className="text-sm text-text-muted">The address does not match anything in this client.</p>
      <Link href="/" className={BUTTON_PRIMARY}>
        Back to the feed
      </Link>
    </div>
  )
}
