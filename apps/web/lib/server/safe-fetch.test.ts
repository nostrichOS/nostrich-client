import { describe, expect, it, vi } from 'vitest'

/** The SSRF guard has to fail closed. */

const lookup = vi.fn()
vi.mock('node:dns/promises', () => {
  const promises = { lookup: (...args: unknown[]) => lookup(...args) }
  return { ...promises, default: promises }
})

const { checkUrl, resolveVerdict } = await import('./safe-fetch')

const temporary = (code: string): Error => Object.assign(new Error(code), { code })

describe('resolveVerdict', () => {
  it('passes a name that resolves to public addresses', async () => {
    lookup.mockResolvedValueOnce([{ address: '104.21.11.96' }, { address: '172.67.165.183' }])
    expect(await resolveVerdict('nostrich.org')).toBe('public')
  })

  it('refuses when ANY address is private, not just the first', async () => {
    // Round-robin DNS with one private record is the actual attack.
    lookup.mockResolvedValueOnce([{ address: '104.21.11.96' }, { address: '10.0.0.5' }])
    expect(await resolveVerdict('evil.test')).toBe('private')
  })

  it('retries once when the resolver says "ask again"', async () => {
    lookup.mockRejectedValueOnce(temporary('EAI_AGAIN'))
    lookup.mockResolvedValueOnce([{ address: '104.21.11.96' }])
    expect(await resolveVerdict('nostrich.org')).toBe('public')
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('gives up as UNRESOLVED rather than pretending the host is private', async () => {
    lookup.mockRejectedValue(temporary('EAI_AGAIN'))
    expect(await resolveVerdict('nostrich.org')).toBe('unresolved')
  })

  it('does not retry a name that does not exist', async () => {
    // NXDOMAIN is an answer.
    lookup.mockReset()
    lookup.mockRejectedValueOnce(temporary('ENOTFOUND'))
    expect(await resolveVerdict('nope.invalid')).toBe('unresolved')
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('judges a literal address without asking DNS anything', async () => {
    lookup.mockReset()
    expect(await resolveVerdict('127.0.0.1')).toBe('private')
    expect(await resolveVerdict('8.8.8.8')).toBe('public')
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('checkUrl', () => {
  it('separates the three refusals', async () => {
    lookup.mockReset()
    expect(await checkUrl('file:///etc/passwd')).toEqual({ ok: false, reason: 'invalid' })
    expect(await checkUrl('not a url')).toEqual({ ok: false, reason: 'invalid' })
    expect(await checkUrl('http://127.0.0.1/admin')).toEqual({ ok: false, reason: 'private' })

    lookup.mockRejectedValue(temporary('EAI_AGAIN'))
    expect(await checkUrl('https://nostrich.org')).toEqual({ ok: false, reason: 'unresolved' })
  })

  it('hands back the parsed URL when it passes', async () => {
    lookup.mockReset()
    lookup.mockResolvedValueOnce([{ address: '104.21.11.96' }])
    const verdict = await checkUrl('https://nostrich.org/a?b=c')
    expect(verdict.ok && verdict.url.pathname).toBe('/a')
  })
})
