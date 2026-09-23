import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Hex } from '@nostrich/nostr'

import {
  connectWallet,
  forgetWalletCache,
  disconnectWallet,
  readWallet,
  DEFAULT_ZAP_PRESETS,
  DEFAULT_ZAP_SATS,
  MAX_ZAP_PRESETS,
  readDefaultZap,
  readZapPresets,
  writeZapPresets,
  type ZapPreset, providerLabel } from './wallet'
import { scopedRecord } from './scope'

/** The zap picker's stored settings. */

const PRESETS_KEY = 'nostrich:zap-presets'
const AMOUNT_KEY = 'nostrich:zap-amount'

/** Storage as the browser hands it back: text, whatever wrote. */
function storeRaw(text: string): void {
  localStorage.setItem(PRESETS_KEY, text)
}

function storeJson(value: unknown): void {
  storeRaw(JSON.stringify(value))
}

/** What was actually persisted, read back through the per-account layer that wrote. */
function readRaw(): unknown {
  const raw = scopedRecord(PRESETS_KEY)?.v
  return raw === undefined ? null : JSON.parse(raw)
}

beforeEach(() => {
  localStorage.clear()
})

describe('falling back to the defaults', () => {
  it('offers the defaults to a reader who has never touched the settings', () => {
    expect(readZapPresets()).toEqual(DEFAULT_ZAP_PRESETS)
  })

  /** The picker with no buttons. */
  it('treats a stored empty list as a reset rather than an empty picker', () => {
    storeJson([])
    expect(readZapPresets()).toEqual(DEFAULT_ZAP_PRESETS)
  })

  /** Same dead end, reached by an array whose every row is rejected rather than by `[]`. */
  it('falls back when nothing in the stored list survives validation', () => {
    storeJson([{ sats: 0 }, { sats: -21 }, 'nope'])
    expect(readZapPresets()).toEqual(DEFAULT_ZAP_PRESETS)
  })

  it('falls back on unparseable storage', () => {
    storeRaw('[{"sats": 21')
    expect(readZapPresets()).toEqual(DEFAULT_ZAP_PRESETS)
  })

  /** Valid JSON of the wrong shape. */
  it('falls back on JSON that is not an array', () => {
    for (const raw of ['{"21":"⚡"}', '"21"', '42', 'null']) {
      storeRaw(raw)
      expect(readZapPresets()).toEqual(DEFAULT_ZAP_PRESETS)
    }
  })

  /** Storage that throws on read is a Safari-shaped failure, not a reason to lose. */
  it('falls back when storage itself refuses', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readZapPresets()).toEqual(DEFAULT_ZAP_PRESETS)
  })
})

describe('rejecting amounts that cannot be zapped', () => {
  /** Sats are indivisible and a zap of nothing is not a zap. */
  it('drops every row whose sats are not a positive integer', () => {
    storeJson([
      { sats: 0 },
      { sats: -21 },
      { sats: 12.5 },
      { sats: '21' },
      { sats: null },
      { label: '⚡' },
      { sats: 21 },
      null,
      'nope',
      7,
    ])
    expect(readZapPresets()).toEqual([{ sats: 21 }])
  })

  /** One bad row must not cost the reader the other eight. */
  it('keeps the good rows around a bad one', () => {
    storeJson([{ sats: 21 }, { sats: -1 }, { sats: 2_100 }])
    expect(readZapPresets().map(preset => preset.sats)).toEqual([21, 2_100])
  })
})

describe('the cap on how many buttons a picker holds', () => {
  it('keeps the first MAX_ZAP_PRESETS rows and drops the rest', () => {
    storeJson(Array.from({ length: MAX_ZAP_PRESETS + 3 }, (_, index) => ({ sats: index + 1 })))

    const presets = readZapPresets()
    expect(presets).toHaveLength(MAX_ZAP_PRESETS)
    expect(presets[MAX_ZAP_PRESETS - 1]?.sats).toBe(MAX_ZAP_PRESETS)
  })

  /** The cap counts buttons, not stored rows. */
  it('does not let rejected rows consume slots', () => {
    const wanted = Array.from({ length: MAX_ZAP_PRESETS }, (_, index) => ({ sats: (index + 1) * 100 }))
    storeJson(wanted.flatMap(preset => [{ sats: -1 }, preset]))

    expect(readZapPresets().map(preset => preset.sats)).toEqual(wanted.map(preset => preset.sats))
  })

  it('persists no more than the cap', () => {
    writeZapPresets(Array.from({ length: MAX_ZAP_PRESETS + 5 }, (_, index) => ({ sats: index + 1 })))
    expect(readRaw()).toHaveLength(MAX_ZAP_PRESETS)
  })
})

describe('labels', () => {
  /** A reader asked for this by name after an earlier build restricted the field. */
  it('stores several emoji and words together, exactly as typed', () => {
    const label = '⚡💜🔥 big tip'
    writeZapPresets([{ sats: 5_000, label }])
    expect(readZapPresets()).toEqual([{ sats: 5_000, label }])
  })

  it('leaves a label sitting exactly on the length limit alone', () => {
    const label = '🍕🍕 pizza night' // 16 UTF-16 units, the cap
    storeJson([{ sats: 5_000, label }])
    expect(readZapPresets()[0]?.label).toBe(label)
  })

  it('caps a label at the width its button can show', () => {
    storeJson([{ sats: 21, label: 'coffee for the whole morning' }])
    expect(readZapPresets()[0]?.label).toBe('coffee for the w')
  })

  /** The absent key matters, not just an absent value: the button renders the label span. */
  it('drops a label that is only whitespace, and trims the rest', () => {
    storeJson([{ sats: 21, label: '   ' }, { sats: 42, label: '  ☕ coffee  ' }])

    const [blank, trimmed] = readZapPresets()
    expect(blank && Object.hasOwn(blank, 'label')).toBe(false)
    expect(trimmed?.label).toBe('☕ coffee')
  })

  it('keeps a row whose label is the wrong type, without the label', () => {
    storeJson([{ sats: 21, label: 42 }])
    expect(readZapPresets()).toEqual([{ sats: 21 }])
  })
})

describe('writing', () => {
  it('round-trips a configured picker unchanged', () => {
    const presets: ZapPreset[] = [
      { sats: 1 },
      { sats: 210, label: '🔥' },
      { sats: 21_000, label: '🧡 thank you' },
    ]
    writeZapPresets(presets)
    expect(readZapPresets()).toEqual(presets)
  })

  /** Writing `[]` is honest. */
  it('stores an emptied list as empty and recovers it on read', () => {
    writeZapPresets([])
    expect(readRaw()).toEqual([])
    expect(readZapPresets()).toEqual(DEFAULT_ZAP_PRESETS)
  })

  /** Safari private mode throws on write. */
  it('does not throw when storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeZapPresets([{ sats: 21 }])).not.toThrow()
  })
})

describe('the default zap amount', () => {
  it('is the one-tap default until the reader picks another', () => {
    expect(readDefaultZap()).toBe(DEFAULT_ZAP_SATS)
  })

  it('reads back a chosen amount', () => {
    localStorage.setItem(AMOUNT_KEY, '2100')
    expect(readDefaultZap()).toBe(2_100)
  })

  /** The blank string is the case that matters: `Number('')` is 0, so a cleared field. */
  it('refuses anything that is not a positive integer', () => {
    for (const raw of ['', '   ', '0', '-21', '12.5', 'abc', 'null', '[]']) {
      localStorage.setItem(AMOUNT_KEY, raw)
      expect(readDefaultZap()).toBe(DEFAULT_ZAP_SATS)
    }
  })
})

describe('one wallet per account', () => {
  /** The connection string authorises SPENDING. */
  const ALICE = 'a'.repeat(64) as Hex
  const BOB = 'b'.repeat(64) as Hex
  const uriFor = (secret: string): string =>
    `nostr+walletconnect://${'d'.repeat(64)}?relay=wss://relay.test&secret=${secret.repeat(64).slice(0, 64)}`

  beforeEach(() => {
    localStorage.clear()
    forgetWalletCache()
  })

  it('keeps each account’s wallet to itself', () => {
    expect(connectWallet(ALICE, uriFor('1')).ok).toBe(true)
    expect(readWallet(ALICE).uri).toBe(uriFor('1'))
    // Bob never connected anything, and must not inherit hers.
    expect(readWallet(BOB).uri).toBeUndefined()

    expect(connectWallet(BOB, uriFor('2')).ok).toBe(true)
    expect(readWallet(BOB).uri).toBe(uriFor('2'))
    // And connecting his does not disturb hers.
    expect(readWallet(ALICE).uri).toBe(uriFor('1'))
  })

  it('disconnects only the account that asked', () => {
    connectWallet(ALICE, uriFor('1'))
    connectWallet(BOB, uriFor('2'))
    disconnectWallet(BOB)
    expect(readWallet(BOB).uri).toBeUndefined()
    expect(readWallet(ALICE).uri).toBe(uriFor('1'))
  })

  it('adopts a pre-account wallet when there is only one account to adopt it', () => {
    localStorage.setItem('nostrich:wallet:v1', uriFor('1'))
    localStorage.setItem('nostrich.accounts', JSON.stringify({ accounts: [{ kind: 'readonly', pubkey: ALICE }], active: ALICE }))
    expect(readWallet(ALICE).uri).toBe(uriFor('1'))
  })

  it('drops a pre-account wallet rather than guess between several accounts', () => {
    // Nothing on disk says who pasted it, and guessing hands a spending key.
    localStorage.setItem('nostrich:wallet:v1', uriFor('1'))
    localStorage.setItem(
      'nostrich.accounts',
      JSON.stringify({ accounts: [{ kind: 'readonly', pubkey: ALICE }, { kind: 'readonly', pubkey: BOB }], active: ALICE }),
    )
    expect(readWallet(ALICE).uri).toBeUndefined()
    expect(localStorage.getItem('nostrich:wallet:v1')).toBeNull()
  })
})

/** The wallet's name when the wallet has not said it yet. */
describe('providerLabel', () => {
  it('names the provider from the address', () => {
    expect(providerLabel('examplewallet@wallet.example')).toBe('Wallet')
    expect(providerLabel('me@coinos.io')).toBe('Coinos')
    expect(providerLabel('someone@getalby.com')).toBe('Getalby')
  })

  it('reads the registrable label, not the subdomain', () => {
    expect(providerLabel('me@pay.walletofsatoshi.com')).toBe('Walletofsatoshi')
  })

  it('folds case in the host', () => {
    expect(providerLabel('Me@Wallet.Example')).toBe('Wallet')
  })

  it('has nothing to say about a non-address', () => {
    expect(providerLabel(undefined)).toBeUndefined()
    expect(providerLabel('')).toBeUndefined()
    expect(providerLabel('lnurl1dp68gurn8ghj7')).toBeUndefined()
    expect(providerLabel('@wallet.example')).toBeUndefined()
  })
})
