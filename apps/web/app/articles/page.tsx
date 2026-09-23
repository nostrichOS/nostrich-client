import { NewsScreen } from '../../components/NewsScreen'

export const metadata = {
  title: 'Articles',
  description: 'Long-form writing published to Nostr as NIP-23 events.',
}

export default function ArticlesPage(): React.ReactNode {
  return <NewsScreen />
}
