import { beforeEach, describe, expect, it } from 'vitest'

import { isDemoted, noteHostFailure, noteHostSuccess, reorderByHealth, resetHostHealth } from './host-health'

const A = 'https://a.example/aa.jpg'
const B = 'https://b.example/bb.jpg'
const C = 'https://c.example/cc.jpg'

beforeEach(resetHostHealth)

describe('host health', () => {
  it('tolerates one failure, a single miss is not a verdict', () => {
    noteHostFailure(A)
    expect(isDemoted(A)).toBe(false)
  })

  it('demotes after the second failure', () => {
    noteHostFailure(A)
    noteHostFailure(A)
    expect(isDemoted(A)).toBe(true)
  })

  it('judges a HOST, not a URL, that is the point', () => {
    noteHostFailure('https://a.example/one.jpg')
    noteHostFailure('https://a.example/two.jpg')
    expect(isDemoted('https://a.example/three.jpg')).toBe(true)
  })

  it('forgives immediately on a success', () => {
    noteHostFailure(A)
    noteHostFailure(A)
    noteHostSuccess(A)
    expect(isDemoted(A)).toBe(false)
  })

  it('never blames a host for another host being down', () => {
    noteHostFailure(A)
    noteHostFailure(A)
    expect(isDemoted(B)).toBe(false)
  })

  it('moves demoted hosts to the back, keeping the caller order otherwise', () => {
    noteHostFailure(A)
    noteHostFailure(A)
    expect(reorderByHealth([A, B, C])).toEqual([B, C, A])
  })

  it('still tries a demoted host, last, never dropped', () => {
    noteHostFailure(A)
    noteHostFailure(A)
    expect(reorderByHealth([A])).toEqual([A])
  })

  it('leaves the order alone when every host is bad', () => {
    for (const url of [A, B]) {
      noteHostFailure(url)
      noteHostFailure(url)
    }
    expect(reorderByHealth([A, B])).toEqual([A, B])
  })

  it('ignores a string that is not a URL rather than throwing', () => {
    expect(() => noteHostFailure('nonsense')).not.toThrow()
    expect(isDemoted('nonsense')).toBe(false)
  })
})
