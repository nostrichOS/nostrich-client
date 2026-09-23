'use client'

import { KINDS, LIVE_EVENT_KIND } from '@nostrich/nostr'

import type { DraftQuote } from '../lib/draft-quote'
import { ArticleCard } from './ArticleCard'
import { QuotedNote } from './QuotedNote'
import { StreamCard } from './StreamCard'

/** WHAT A PASTED POINTER WILL LOOK LIKE ONCE POSTED. */
export function DraftQuoteCard({ quote }: { quote: DraftQuote }): React.ReactNode {
  if (quote.type === 'event') {
    return (
      <QuotedNote
        pointer={{
          id: quote.id,
          relays: quote.relays,
          ...(quote.author === undefined ? {} : { author: quote.author }),
        }}
      />
    )
  }

  const pointer = {
    kind: quote.kind,
    pubkey: quote.pubkey,
    identifier: quote.identifier,
    bech32: quote.bech32,
    ...(quote.relays === undefined ? {} : { relays: quote.relays }),
  }
  if (quote.kind === LIVE_EVENT_KIND) return <StreamCard pointer={pointer} />
  if (quote.kind === KINDS.longForm) return <ArticleCard pointer={pointer} />
  return null
}
