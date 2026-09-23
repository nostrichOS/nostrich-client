import { describe, expect, it } from 'vitest'
import { NUTZAP_KIND, parseNutzap } from './nutzap'
import type { Hex, NostrEvent } from './types'

const ME = 'a'.repeat(64) as Hex
const THEM = 'b'.repeat(64) as Hex
const MINT = 'https://mint.wallet.example/Bitcoin'
const proof = (amount: number) => ['proof', JSON.stringify({ amount, secret: 'x', C: 'y', id: 'z' })]

function nutzap(tags: string[][], content = ''): NostrEvent {
  return { id: 'n'.repeat(64), pubkey: THEM, created_at: 1_000, kind: NUTZAP_KIND, tags, content, sig: '0'.repeat(128) }
}

describe('parseNutzap', () => {
  it('reads the amount as the SUM of the proofs', () => {
    // The 21 sats that started this arrived as 16 + 4 + 1.
    const z = parseNutzap(nutzap([['p', ME], ['u', MINT], proof(16), proof(4), proof(1)]), ME)
    expect(z?.amountSats).toBe(21)
  })

  it('keeps the note it was sent to, and copes when there is none', () => {
    const target = 'c'.repeat(64)
    expect(parseNutzap(nutzap([['p', ME], ['u', MINT], ['e', target], proof(21)]), ME)?.targetId).toBe(target)
    expect(parseNutzap(nutzap([['p', ME], ['u', MINT], proof(21)]), ME)?.targetId).toBeUndefined()
  })

  it('names the sender as the event author, a nutzap IS the payment', () => {
    // Unlike a kind-9735, whose author is the lightning server and never the payer.
    expect(parseNutzap(nutzap([['p', ME], ['u', MINT], proof(21)]), ME)?.sender).toBe(THEM)
  })

  it("refuses an event addressed to somebody else", () => {
    // The `p` tag is the sender's claim.
    expect(parseNutzap(nutzap([['p', THEM], ['u', MINT], proof(21)]), ME)).toBeUndefined()
  })

  it('refuses ecash with no mint named', () => {
    // "21 sats of something" is not money the reader can go and get.
    expect(parseNutzap(nutzap([['p', ME], proof(21)]), ME)).toBeUndefined()
  })

  it('refuses an event carrying no spendable amount', () => {
    expect(parseNutzap(nutzap([['p', ME], ['u', MINT]]), ME)).toBeUndefined()
    expect(parseNutzap(nutzap([['p', ME], ['u', MINT], proof(0)]), ME)).toBeUndefined()
  })

  it('ignores a malformed proof instead of poisoning the total', () => {
    const z = parseNutzap(nutzap([
      ['p', ME], ['u', MINT], proof(21), ['proof', 'not json'], ['proof', JSON.stringify({ amount: 'lots' })],
      ['proof', JSON.stringify({ amount: -5 })], ['proof', JSON.stringify({ amount: 1.5 })],
    ]), ME)
    expect(z?.amountSats).toBe(21)
  })

  it('is not fooled by another kind wearing the same tags', () => {
    const wrongKind = { ...nutzap([['p', ME], ['u', MINT], proof(21)]), kind: 9735 }
    expect(parseNutzap(wrongKind, ME)).toBeUndefined()
  })

  it("carries the payer's message", () => {
    expect(parseNutzap(nutzap([['p', ME], ['u', MINT], proof(21)], 'Sure and …'), ME)?.comment).toBe('Sure and …')
  })
})
