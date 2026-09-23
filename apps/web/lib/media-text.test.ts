import { describe, expect, it } from 'vitest'

import { splitMessage } from './media-text'

/** What a chat bubble shows. */
describe('splitMessage', () => {
  it('keeps a plain message exactly', () => {
    expect(splitMessage('hello there').text).toBe('hello there')
  })

  /** The bug as reported: ordinary messages rendering as empty bubbles. */
  it('never empties a body that has no media', () => {
    for (const source of ['gm', 'a longer sentence with punctuation!', '1', 'https://example.com']) {
      expect(splitMessage(source).text).toBe(source)
    }
  })

  it('returns the author\'s own characters, never a rebuilt string', () => {
    // Subtracting the media from the original is what guarantees.
    expect(splitMessage('talking about $BTC today').text).toBe('talking about $BTC today')
  })

  it('pulls a picture out and leaves the words', () => {
    const parts = splitMessage('look at this https://example.com/a.jpg')
    expect(parts.text).toBe('look at this')
    expect(parts.media.map(m => m.url)).toEqual(['https://example.com/a.jpg'])
  })

  it('leaves nothing behind when the body is only a picture', () => {
    const parts = splitMessage('https://example.com/a.jpg')
    expect(parts.text).toBe('')
    expect(parts.media).toHaveLength(1)
  })

  it('recognises video', () => {
    const parts = splitMessage('clip https://example.com/v.mp4')
    expect(parts.media[0]?.type).toBe('video')
  })

  /** `replace` would have left the second copy as a bare URL in the text. */
  it('removes every copy of a repeated picture', () => {
    const url = 'https://example.com/a.jpg'
    expect(splitMessage(`${url} and again ${url}`).text).toBe('and again')
  })

  it('keeps several distinct pictures', () => {
    const parts = splitMessage('a https://e.com/1.jpg b https://e.com/2.png')
    expect(parts.media.map(m => m.url)).toEqual(['https://e.com/1.jpg', 'https://e.com/2.png'])
    expect(parts.text).toBe('a  b')
  })
})
