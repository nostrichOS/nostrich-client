import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { brand, palette } from '@nostrich/ui'

/** THE BRAND COLOURS MUST STAY THE LOGO'S COLOURS. */

const PUBLIC = join(import.meta.dirname, '..', 'public')
const read = (name: string): string => readFileSync(join(PUBLIC, name), 'utf8').toUpperCase()
const hex = (value: string): string => value.toUpperCase()

describe('brand tokens', () => {
  it('takes cream, ember and ink from logo.svg', () => {
    const logo = read('logo.svg')
    expect(logo).toContain(hex(brand.cream))
    expect(logo).toContain(hex(brand.ember))
    expect(logo).toContain(hex(brand.ink))
  })

  it('takes the rim and the deeper cream from favicon.svg', () => {
    const favicon = read('favicon.svg')
    expect(favicon).toContain(hex(brand.rim))
    expect(favicon).toContain(hex(brand.creamDeep))
  })

  it('takes the softer ink from the wordmark', () => {
    expect(read('wordmark.svg')).toContain(hex(brand.inkSoft))
  })

  it('is reachable from the shared palette, so nothing imports a bare hex string', () => {
    expect(palette.brand).toBe(brand)
  })

  it('is six-digit hex throughout, an RN StyleSheet takes neither shorthand nor names', () => {
    for (const value of Object.values(brand)) expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})
