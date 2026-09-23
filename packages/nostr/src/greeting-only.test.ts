import { describe, expect, it } from 'vitest'

import { isGreetingOnly, spokenWords } from './spam-shape'

/** "many notes with only GM trending". */
describe('isGreetingOnly', () => {
  it('catches the notes that were reported', () => {
    expect(isGreetingOnly('GM! https://cdn-a.example/6d8eb1b7.jpg')).toBe(true)
    expect(isGreetingOnly('GM https://haven.dergigi.com/c4fe3e8e.png')).toBe(true)
    expect(isGreetingOnly('gm  https://cdn-a.example/bede3235.jpg')).toBe(true)
    expect(isGreetingOnly('lol   https://npub1lrnvvs6z78s9yjqxxr38uyqkmn34lsax')).toBe(true)
  })

  it('spares a greeting that goes on to say something', () => {
    // Both were on the same chart and both belong there.
    expect(isGreetingOnly('GM☕  Can\'t have it both ways bro. https://cdn-a.example/x.jpg')).toBe(false)
    expect(isGreetingOnly('Gm nostr   Happy Thirstday, everybody https://image.nostr.build/9.jpg')).toBe(false)
  })

  it('SPARES AN UNCAPTIONED PHOTO, which is the easy mistake', () => {
    // Stripped of its link it has no words at all, and rejecting that as "empty" would.
    expect(isGreetingOnly('https://cdn-a.example/9ffb97d8.jpg')).toBe(false)
    expect(isGreetingOnly('')).toBe(false)
  })

  it('spares a bare link share for the same reason', () => {
    expect(isGreetingOnly('https://www.instagram.com/p/Dbo7mkWkrJj/ https://cdn.example/x.jpg')).toBe(false)
  })

  it('spares short notes that are not greetings', () => {
    expect(isGreetingOnly('Wild times https://cdn-a.example/56d00f69.jpg')).toBe(false)
    expect(isGreetingOnly('Day 4 of no vaping.')).toBe(false)
    expect(isGreetingOnly('A renaissance is better branding than a revolution')).toBe(false)
  })

  it('treats a repeated greeting as one', () => {
    expect(isGreetingOnly('gm gm')).toBe(true)
    expect(isGreetingOnly('GM GM GM ☕️')).toBe(true)
  })

  it('stops caring past a handful of words', () => {
    // Five words of anything is somebody talking, whatever the words.
    expect(isGreetingOnly('gm gm gm gm gm')).toBe(false)
  })

  it('is not fooled by emoji or punctuation standing in for words', () => {
    expect(isGreetingOnly('gm!!! ☕️☕️☕️ 🌞')).toBe(true)
    expect(isGreetingOnly('gm, but have you seen this')).toBe(false)
  })

  it('ignores mentions and hashtags when deciding', () => {
    expect(isGreetingOnly('GM nostr:npub1abc #coffee')).toBe(true)
  })
})

describe('spokenWords', () => {
  it('is what remains after links, mentions, emoji and punctuation', () => {
    expect(spokenWords('GM! ☕️ https://x.example/a.jpg nostr:npub1abc #gm')).toBe('GM')
  })

  it('is empty for a picture with no caption', () => {
    expect(spokenWords('https://x.example/a.jpg')).toBe('')
  })
})
