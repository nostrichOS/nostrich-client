'use client'

import { parseContent, type Hex, type RelayUrl } from '@nostrich/nostr'

/** THE POINTER SOMEBODY PASTED INTO A COMPOSER. */

interface Raw {
  /** The exact text to lift out of the draft. */
  raw: string
}

export type DraftQuote =
  | ({ type: 'event'; id: Hex; bech32: string; relays: RelayUrl[]; author?: Hex } & Raw)
  | ({
      type: 'address'
      kind: number
      pubkey: Hex
      identifier: string
      bech32: string
      relays?: RelayUrl[]
    } & Raw)

/** The first quotable pointer in a draft, if there is one. */
export function draftQuote(text: string): DraftQuote | undefined {
  if (!text.includes('nostr:') && !text.includes('nevent1') && !text.includes('naddr1')) {
    // Cheap reject first: this runs on every keystroke in the composer.
    return undefined
  }
  const segments = parseContent(text, [])
  for (const segment of segments) {
    if (segment.type === 'event') {
      return {
        type: 'event',
        raw: segment.bech32,
        id: segment.id,
        // Kept as WRITTEN, because it is what gets stripped from the draft and re-appended.
        bech32: segment.bech32,
        relays: segment.relays ?? [],
        ...(segment.author === undefined ? {} : { author: segment.author }),
      }
    }
    if (segment.type === 'address') {
      return {
        type: 'address',
        raw: segment.bech32,
        kind: segment.kind,
        pubkey: segment.pubkey,
        identifier: segment.identifier,
        bech32: segment.bech32,
        ...(segment.relays === undefined ? {} : { relays: segment.relays }),
      }
    }
  }

  /* NOTHING TYPED AS A POINTER. */
  for (const segment of segments) {
    if (segment.type !== 'url') continue
    const quote = fromUrl(segment.url)
    if (quote !== undefined) return quote
  }
  return undefined
}

/** A pointer sitting in the last path segment of a URL. */
function fromUrl(url: string): DraftQuote | undefined {
  const match = /\/((?:nevent|naddr|note)1[a-z0-9]+)(?:[?#/].*)?$/iu.exec(url)
  const token = match?.[1]
  if (token === undefined) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(token)
  } catch {
    return undefined
  }
  const quote = draftQuote(decoded)
  // The URL is what leaves the draft.
  return quote === undefined ? undefined : { ...quote, raw: url }
}

/** A stable key for memoising the card, so typing does not re-resolve. */
export function draftQuoteKey(quote: DraftQuote | undefined): string {
  if (quote === undefined) return ''
  return quote.type === 'event'
    ? `e:${quote.id}`
    : `a:${quote.kind}:${quote.pubkey}:${quote.identifier}`
}

/** The draft with a pasted thing taken out. */
export function removeFromDraft(text: string, raw: string): string {
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return text
    .replace(new RegExp(`(?:nostr:)?${escaped}`, 'gu'), '')
    // Two blank lines where the pointer stood is the hole it left, not a paragraph break.
    .replace(/[^\S\n]*\n{3,}[^\S\n]*/gu, '\n\n')
    .replace(/[^\S\n]+$/gu, '')
    .replace(/\s+$/u, '')
}

/** WHAT A LIFTED POINTER BECOMES IN THE PUBLISHED NOTE. */
export function publishedForm(quote: DraftQuote): string {
  // `raw === bech32` means it was typed as a pointer rather than pasted as a link.
  if (quote.raw === quote.bech32) return `nostr:${quote.bech32}`
  return `https://nostrich.org/e/${quote.bech32}`
}
