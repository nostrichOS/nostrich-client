import { describe, expect, it } from 'vitest'

import { draftQuote, draftQuoteKey, publishedForm, removeFromDraft } from './draft-quote'

/** What the composer previews while you type. */

// A real article pointer, as pasted from another client.
const NEVENT =
  'nevent1qgsfff483fdwhwayp0g64g3rfqgpxtpdsqzthythv9kyz0fuph0nyrsqyp0hzh42vguye607g6wjzycvf865fykwht26pe3gzhqpnyma3fc75aujtxa'
// A real live-stream pointer, with relay hints in its TLV.
const NADDR =
  'naddr1qqjxvvfn8yukyde4943nwcnz956rye3k94sngenr94jxxet9vcurxdp5v5cxyqgkwaehxw309aex2mrp0yhxcet5wdnx7tnrdaksz9thwden5te0wfjkccte9emkzumtw5hxxmmdqyv8wumn8ghj7un9d3shjtnndehhyapwwdhkx6tpdsq3vamnwvaz7tmjv4kxz7fwwpexjmtpdshxuet5qywhwumn8ghj7mn0wd68yttsw43zuam9d3kx7unyv4ezumn9wspzp56ftw7qrtyz9ymwu7y585xmt9mgy7x0sd8k844r2mu9sglhzg0lqvzqqqrkvu0wsarx'

describe('draftQuote', () => {
  it('finds a pasted nevent', () => {
    const quote = draftQuote(`look at this ${NEVENT}`)
    expect(quote?.type).toBe('event')
    expect((quote as { id: string }).id).toBe(
      '5f715eaa62384ce9fe469d21130c49f54492cebad5a0e62815c019937d8a71ea',
    )
  })

  it('carries the author, which is what makes a quote resolvable at all', () => {
    // There is no global index on Nostr: an id with no author can only be looked.
    const quote = draftQuote(NEVENT)
    expect((quote as { author?: string }).author).toBe(
      '94a6a78a5aebbba40bd1aaa2234810132c2d8004bb9177616c413d3c0ddf320e',
    )
  })

  it('finds a pasted naddr and keeps its relay hints', () => {
    /* The hints matter more for an address than for an id: an addressable event is often. */
    const quote = draftQuote(`watch nostr:${NADDR}`)
    expect(quote?.type).toBe('address')
    const address = quote as { kind: number; identifier: string; relays?: string[] }
    expect(address.kind).toBe(30311)
    expect(address.identifier).toBe('f1399b75-c7bb-42f6-a4fc-dceef8344e0b')
    expect(address.relays?.length ?? 0).toBeGreaterThan(0)
  })

  it('reads the nostr: prefix and the bare form alike', () => {
    // People paste whichever their client gave them.
    expect(draftQuote(`nostr:${NEVENT}`)?.type).toBe('event')
    expect(draftQuote(NEVENT)?.type).toBe('event')
  })

  it('takes only the FIRST pointer', () => {
    // A note renders one quote card.
    const quote = draftQuote(`${NEVENT} and also nostr:${NADDR}`)
    expect(quote?.type).toBe('event')
  })

  it('ignores a draft with no pointer', () => {
    expect(draftQuote('just some words about nostr and relays')).toBeUndefined()
    expect(draftQuote('')).toBeUndefined()
  })

  it('ignores a pointer that does not decode', () => {
    // Half-pasted bech32 is something people produce constantly, and it must not draw.
    expect(draftQuote('nevent1qqqqq')).toBeUndefined()
  })

  it('does not treat an npub mention as a quote', () => {
    // A mention is a person, not a quoted note.
    expect(
      draftQuote('hello nostr:npub1gvyjg5qk7uyxnfjwh5jhptmw2qw7v0qkh96meza665j033hf0jxq73s2mj'),
    ).toBeUndefined()
  })
})

describe('draftQuoteKey', () => {
  it('is stable across keystrokes so the card is not re-resolved per character', () => {
    /* THE REASON THIS EXISTS. */
    expect(draftQuoteKey(draftQuote(`a ${NEVENT}`))).toBe(draftQuoteKey(draftQuote(`ab ${NEVENT}`)))
  })

  it('changes when the pointer changes', () => {
    expect(draftQuoteKey(draftQuote(NEVENT))).not.toBe(draftQuoteKey(draftQuote(NADDR)))
  })

  it('is empty for no quote', () => {
    expect(draftQuoteKey(undefined)).toBe('')
  })
})

describe('removeFromDraft', () => {
  it('takes out the bare pointer', () => {
    expect(removeFromDraft(`check this ${NEVENT}`, NEVENT)).toBe('check this')
  })

  it('takes out the nostr: form too', () => {
    // People paste whichever their client gave them.
    expect(removeFromDraft(`check this nostr:${NEVENT}`, NEVENT)).toBe('check this')
  })

  it('leaves the words around it intact', () => {
    expect(removeFromDraft(`before ${NEVENT} after`, NEVENT)).toBe('before  after')
  })

  it('does not leave the hole as a paragraph break', () => {
    /* A pointer on its own line between two paragraphs leaves three newlines behind. */
    expect(removeFromDraft(`words\n\n${NEVENT}\n\nmore`, NEVENT)).toBe('words\n\nmore')
  })

  it('leaves a draft that does not contain it completely alone', () => {
    // The composer compares before and after and skips the write when nothing changed.
    const text = 'nothing to lift here'
    expect(removeFromDraft(text, NEVENT)).toBe(text)
  })

  it('trims the trailing blank a lifted pointer leaves at the end', () => {
    expect(removeFromDraft(`come hang out\n${NEVENT}`, NEVENT)).toBe('come hang out')
  })
})

describe('a pointer inside a URL', () => {
  const URL_FORM = `https://nostrich.org/e/${NEVENT}`

  it('reads our own /e/ link as a quote', () => {
    // People share notes by copying the address bar at least as often as by copying.
    const quote = draftQuote(`have a look ${URL_FORM}`)
    expect(quote?.type).toBe('event')
    expect((quote as { id: string }).id).toBe(
      '5f715eaa62384ce9fe469d21130c49f54492cebad5a0e62815c019937d8a71ea',
    )
  })

  it('reads another client\'s link the same way', () => {
    // The rule is the last path segment, not a list of hostnames somebody has to maintain.
    expect(draftQuote(`https://njump.me/${NEVENT}`)?.type).toBe('event')
  })

  it('keeps the URL as what leaves the draft and the pointer as what gets published', () => {
    /* THE DISTINCTION THIS TYPE EXISTS. */
    const quote = draftQuote(URL_FORM)
    expect(quote?.raw).toBe(URL_FORM)
    expect(quote?.bech32).toBe(NEVENT)
    expect(removeFromDraft(`have a look ${URL_FORM}`, quote!.raw)).toBe('have a look')
  })

  it('prefers a typed pointer over one buried in a link further down', () => {
    const quote = draftQuote(`${NADDR}\nand ${URL_FORM}`)
    expect(quote?.type).toBe('address')
  })

  it('ignores a link that merely looks like one', () => {
    expect(draftQuote('https://nostrich.org/e/not-a-pointer')).toBeUndefined()
    expect(draftQuote('https://nostrich.org/about')).toBeUndefined()
  })

  it('survives a trailing slash or query', () => {
    expect(draftQuote(`https://nostrich.org/e/${NEVENT}?x=1`)?.type).toBe('event')
  })
})

describe('publishedForm', () => {
  it('keeps a typed pointer as a pointer', () => {
    /* `nostr:` is the interoperable form: every client on the network turns. */
    expect(publishedForm(draftQuote(NEVENT)!)).toBe(`nostr:${NEVENT}`)
  })

  it('re-homes another client\'s link to ours', () => {
    // Sharing a note is not advertising a client, and the pointer inside their link names.
    expect(publishedForm(draftQuote(`https://example-client.test/e/${NEVENT}`)!)).toBe(
      `https://nostrich.org/e/${NEVENT}`,
    )
    expect(publishedForm(draftQuote(`https://njump.me/${NEVENT}`)!)).toBe(
      `https://nostrich.org/e/${NEVENT}`,
    )
  })

  it('leaves our own link on our own domain', () => {
    expect(publishedForm(draftQuote(`https://nostrich.org/e/${NEVENT}`)!)).toBe(
      `https://nostrich.org/e/${NEVENT}`,
    )
  })
})
