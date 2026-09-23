import { Suspense } from 'react'

import { SearchScreen } from '../../components/SearchScreen'

export const metadata = { title: 'Search' }

/** Results are driven entirely by the query string and fetched from relays. */
export default function SearchPage(): React.ReactNode {
  return (
    <Suspense fallback={null}>
      <SearchScreen />
    </Suspense>
  )
}
