import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** WHAT THE PREFETCHER IS ALLOWED TO COST, BECAUSE IT PAYS IT ON EVERY ROUTE. */
const web = join(__dirname, '..')
const read = (...parts: string[]): string => readFileSync(join(web, ...parts), 'utf8')

describe('the prefetcher warms without forcing', () => {
  const prefetch = read('components', 'Prefetch.tsx')

  it('asks the zap ledger to warm rather than refetch', () => {
    expect(prefetch).toContain(
      'useProfileZaps(pubkey, profile, useDelayed(ZAPS_WARM_DELAY_MS), true)',
    )
  })

  it('and the ledger honours that instead of forcing on every mount', () => {
    const zaps = read('lib', 'profile-zaps.ts')
    expect(zaps).toContain("refetchOnMount: warm ? false : 'always'")
    /* Against the CODE, comments stripped. */
    const code = zaps.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(code).not.toMatch(/refetchOnMount: 'always'/)
  })

  it('leaves the screens forcing, which is where it was always correct', () => {
    // A reader who OPENS the ledger gets a figure checked on open.
    for (const [file, call] of [
      ['ZapsScreen.tsx', 'useProfileZaps(pubkey, profile, true)'],
      ['ProfileScreen.tsx', "useProfileZaps(pubkey, profile, tab === 'zaps')"],
    ] as const) {
      expect(read('components', file)).toContain(call)
    }
  })
})

describe('notifications warm the same way', () => {
  /* The first instance of this bug, kept beside the second so the pattern is visible. */
  it('the hidden notifications screen goes warm', () => {
    expect(read('components', 'NotificationsScreen.tsx')).toContain('!active,')
  })

  it('and warm is what gates the expensive follower query', () => {
    expect(read('lib', 'notifications.ts')).toContain('useFollowerLists(pubkey, !warm)')
  })
})

describe('opening the Wallet does not wake the wallet', () => {
  const wallet = read('lib', 'wallet.ts')
  const screen = read('components', 'ZapsScreen.tsx')

  /** An NWC call is not an HTTP request. */
  it('asks for the alias through a cached query, not an effect', () => {
    expect(screen).toContain('const walletName = useWalletAlias(viewer)')
    expect(screen).not.toContain('await client.getInfo()')
  })

  it('and never re-asks, because an alias does not change', () => {
    const hook = wallet.slice(wallet.indexOf('export function useWalletAlias'))
    expect(hook).toContain('staleTime: Number.POSITIVE_INFINITY')
  })

  it('keeps the answer per wallet, so a swapped connection does not inherit a name', () => {
    const hook = wallet.slice(wallet.indexOf('export function useWalletAlias'))
    expect(hook).toContain("queryKey: ['wallet-alias', pubkey ?? '', wallet ?? '']")
    expect(wallet).toContain('return held.wallet === wallet ? held.alias : undefined')
  })

  it('still asks nothing at all for an unadvertised method', () => {
    // `get_budget` is the one the provider answers with NOT_IMPLEMENTED.
    expect(wallet).toContain("if (methods !== undefined && !methods.includes('get_budget')) return null")
  })
})
