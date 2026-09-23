import { ArticleEditor } from '@/components/ArticleEditor'

export const metadata = {
  title: 'Write',
  description: 'Write a long-form article and publish it to Nostr as a NIP-23 event.',
}

export default function WritePage(): React.ReactNode {
  return <ArticleEditor />
}
