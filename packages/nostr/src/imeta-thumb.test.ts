import { describe, expect, it } from 'vitest'

import { imetaThumbFor } from './blossom'

const FULL = 'https://nostr.download/df366a9e.png'
const THUMB = 'https://nostr.download/thumb/df366a9e.png'
const tag = (...fields: string[]): string[] => ['imeta', ...fields]

describe('imetaThumbFor', () => {
  it('finds the thumbnail a note published beside its image', () => {
    expect(imetaThumbFor([tag(`url ${FULL}`, 'm image/png', `thumb ${THUMB}`)], FULL)).toBe(THUMB)
  })

  it('matches on the url, because a note with four images has four tags', () => {
    const tags = [
      tag('url https://host/a.png', 'thumb https://host/thumb/a.png'),
      tag(`url ${FULL}`, `thumb ${THUMB}`),
    ]
    expect(imetaThumbFor(tags, FULL)).toBe(THUMB)
  })

  it('is undefined when the note published no thumbnail', () => {
    expect(imetaThumbFor([tag(`url ${FULL}`, 'm image/png')], FULL)).toBeUndefined()
  })

  it('ignores a thumb belonging to a different image', () => {
    expect(imetaThumbFor([tag('url https://host/other.png', `thumb ${THUMB}`)], FULL)).toBeUndefined()
  })

  it('refuses a thumb that is not https, this becomes an <img src>', () => {
    expect(imetaThumbFor([tag(`url ${FULL}`, 'thumb http://host/t.png')], FULL)).toBeUndefined()
    expect(imetaThumbFor([tag(`url ${FULL}`, 'thumb javascript:alert(1)')], FULL)).toBeUndefined()
  })

  it('never hands back the url that just failed', () => {
    expect(imetaThumbFor([tag(`url ${FULL}`, `thumb ${FULL}`)], FULL)).toBeUndefined()
  })

  it('tolerates malformed tags rather than throwing', () => {
    expect(imetaThumbFor([['imeta'], ['e', 'x'], tag('thumb')], FULL)).toBeUndefined()
  })
})
